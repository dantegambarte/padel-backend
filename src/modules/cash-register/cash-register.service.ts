import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryRunner, Repository } from 'typeorm';

import { CashSession, CashSessionStatus } from './entities/cash-session.entity';
import { Transaction, TransactionType } from './entities/transaction.entity';
import { User } from '../users/entities/user.entity';
import { CloseSessionDto } from './dto/close-session.dto';
import { OpenSessionDto } from './dto/open-session.dto';

export interface RegisterTransactionInput {
  cashSessionId: string;
  type: TransactionType;
  referenceId: string;
  concept: string;
  amountCash: number;
  amountTransfer: number;
  createdByUserId: string;
}

@Injectable()
export class CashRegisterService {
  private readonly logger = new Logger(CashRegisterService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,

    @InjectRepository(CashSession)
    private readonly sessionRepo: Repository<CashSession>,

    @InjectRepository(Transaction)
    private readonly transactionRepo: Repository<Transaction>,
  ) {}

  // ─── Apertura Manual ────────────────────────────────────────────────────────

  /**
   * Abre una nueva sesión de caja manualmente.
   * Requiere que no exista ninguna sesión OPEN en este momento.
   * Registra el fondo de caja / cambio inicial declarado por el empleado.
   */
  async openSession(dto: OpenSessionDto, user: User): Promise<CashSession> {
    const existing = await this.sessionRepo.findOne({
      where: { status: CashSessionStatus.OPEN },
      order: { openedAt: 'DESC' } as any,
    });

    if (existing) {
      throw new ConflictException(
        'Ya existe una sesión de caja abierta. Cerrá la jornada actual antes de abrir una nueva.',
      );
    }

    // Generar una nueva fecha comercial para la próxima jornada.
    // No se bloquea si ya hubo una caja cerrada hoy: el empleado puede abrir
    // una nueva jornada en el mismo día comercial (turno mañana / turno tarde).
    const commercialDate = this.getCommercialDate();

    const session = this.sessionRepo.create({
      date: commercialDate,
      status: CashSessionStatus.OPEN,
      openedByUserId: user.id,
      initialBalance: dto.initialBalance,
      notes: dto.notes || undefined,
    });

    let saved: CashSession;
    try {
      saved = await this.sessionRepo.save(session);
    } catch (err: any) {
      // Código 23505 = unique_violation en Postgres.
      // Ocurre si la migración DropUniqueDateCashSessions aún no fue ejecutada
      // y ya existe una sesión (abierta o cerrada) con la misma fecha comercial.
      if (err?.code === '23505') {
        throw new ConflictException(
          'Ya existe una sesión registrada para esta jornada. Ejecuta la migración "DropUniqueDateCashSessions" para permitir múltiples jornadas por día.',
        );
      }
      throw err;
    }
    this.logger.log(
      `Caja abierta por ${user.username} | Jornada ${commercialDate} | Fondo inicial: $${dto.initialBalance}`,
    );
    return saved;
  }

  // ─── Obtener Sesión Activa para Transacciones ────────────────────────────

  /**
   * Obtiene la sesión de caja ABIERTA actualmente.
   * Si no existe ninguna sesión abierta lanza un error —
   * el empleado debe abrir la caja antes de registrar cualquier cobro.
   *
   * Debe llamarse dentro de un QueryRunner activo.
   */
  async getActiveSessionOrFail(queryRunner: QueryRunner, userId: string): Promise<CashSession> {
    // Lock global para evitar race conditions
    await queryRunner.query(`SELECT pg_advisory_xact_lock(abs(hashtext($1)))`, [
      `cash_session:open`,
    ]);

    const openSession = await queryRunner.manager.findOne(CashSession, {
      where: { status: CashSessionStatus.OPEN },
      order: { openedAt: 'DESC' } as any,
      lock: { mode: 'pessimistic_write' },
    });

    if (openSession) {
      return openSession;
    }

    // No hay caja abierta → el empleado debe abrirla manualmente
    throw new BadRequestException({
      errorCode: 'CAJA_CERRADA',
      message: 'Debes abrir la caja antes de registrar cualquier cobro o venta.',
    });
  }

  // ─── Registrar Movimiento ────────────────────────────────────────────────

  /**
   * Registra un movimiento financiero en la sesión de caja.
   * Debe llamarse dentro del mismo QueryRunner que la operación origen.
   */
  async registerTransaction(
    queryRunner: QueryRunner,
    data: RegisterTransactionInput,
  ): Promise<Transaction> {
    const tx = queryRunner.manager.create(Transaction, {
      cashSessionId: data.cashSessionId,
      type: data.type,
      referenceId: data.referenceId,
      concept: data.concept,
      amountCash: data.amountCash,
      amountTransfer: data.amountTransfer,
      createdByUserId: data.createdByUserId,
    });

    return queryRunner.manager.save(Transaction, tx);
  }

  // ─── Estado Actual de la Caja ────────────────────────────────────────────

  /**
   * Retorna el estado completo de la sesión de caja:
   *  - Sin ?date → busca ÚNICAMENTE la sesión OPEN activa.
   *               Si no hay ninguna abierta → session: null (mostrar pantalla de Apertura).
   *  - Con ?date → consulta histórica exacta para esa fecha (puede ser CLOSED).
   */
  async getCurrentSession(date?: string): Promise<{
    session: CashSession | null;
    cashExpected: number;
    transferTotal: number;
    dayTotal: number;
    initialBalance: number;
    transactions: {
      id: string;
      type: string;
      referenceId: string;
      concept: string;
      amountCash: string;
      amountTransfer: string;
      createdAt: string;
      customerName: string | null;
      createdByFullName: string | null;
      createdByUsername: string | null;
    }[];
    isOpen: boolean;
  }> {
    let session: CashSession | null;

    if (date) {
      // Consulta histórica: buscar por fecha específica
      session = await this.sessionRepo.findOne({
        where: { date },
        relations: ['openedByUser', 'closedByUser'],
      });
    } else {
      // Buscar ÚNICAMENTE la sesión ABIERTA activa.
      // Si está cerrada → session: null → frontend muestra pantalla de Apertura.
      session = await this.sessionRepo.findOne({
        where: { status: CashSessionStatus.OPEN },
        order: { openedAt: 'DESC' } as any,
        relations: ['openedByUser', 'closedByUser'],
      });
    }

    if (!session) {
      return {
        session: null,
        cashExpected: 0,
        transferTotal: 0,
        dayTotal: 0,
        initialBalance: 0,
        transactions: [],
        isOpen: false,
      };
    }

    const totals = await this.dataSource.query<{ cash_expected: string; transfer_total: string }[]>(
      `SELECT
         COALESCE(SUM(amount_cash), 0)       AS cash_expected,
         COALESCE(SUM(amount_transfer), 0)   AS transfer_total
       FROM transactions
       WHERE cash_session_id = $1`,
      [session.id],
    );

    const cashExpected = parseFloat(totals[0]?.cash_expected ?? '0');
    const transferTotal = parseFloat(totals[0]?.transfer_total ?? '0');

    const transactions = await this.dataSource.query(
      `SELECT
         t.id,
         t.type,
         t.reference_id        AS "referenceId",
         t.concept,
         t.amount_cash         AS "amountCash",
         t.amount_transfer     AS "amountTransfer",
         t.created_at          AS "createdAt",
         s.customer_name       AS "customerName",
         u.full_name           AS "createdByFullName",
         u.username            AS "createdByUsername"
       FROM transactions t
       LEFT JOIN sales s ON s.id = t.reference_id AND t.type = 'sale'
       LEFT JOIN users u ON u.id = t.created_by_user_id
       WHERE t.cash_session_id = $1
       ORDER BY t.created_at DESC`,
      [session.id],
    );

    return {
      session,
      cashExpected,
      transferTotal,
      dayTotal: cashExpected + transferTotal,
      initialBalance: Number(session.initialBalance) || 0,
      transactions,
      isOpen: session.status === CashSessionStatus.OPEN,
    };
  }

  // ─── Cierre Z ────────────────────────────────────────────────────────────

  /**
   * Ejecuta el cierre Z: calcula la diferencia entre lo contado y lo esperado,
   * cierra la sesión e impide nuevas operaciones para la jornada.
   */
  async closeSession(
    dto: CloseSessionDto,
    user: User,
  ): Promise<{
    session: CashSession;
    cashExpected: number;
    transferTotal: number;
    dayTotal: number;
    difference: number;
    balances: 'exact' | 'surplus' | 'shortage';
  }> {
    const session = await this.sessionRepo.findOne({
      where: { status: CashSessionStatus.OPEN },
      order: { openedAt: 'DESC' } as any,
    });

    if (!session) {
      throw new NotFoundException(
        'No existe una sesión de caja abierta. No se puede realizar el cierre.',
      );
    }

    const totals = await this.dataSource.query<{ cash_expected: string; transfer_total: string }[]>(
      `SELECT
         COALESCE(SUM(amount_cash), 0)     AS cash_expected,
         COALESCE(SUM(amount_transfer), 0) AS transfer_total
       FROM transactions
       WHERE cash_session_id = $1`,
      [session.id],
    );

    const cashExpected = parseFloat(totals[0]?.cash_expected ?? '0');
    const transferTotal = parseFloat(totals[0]?.transfer_total ?? '0');
    const difference = dto.cashCounted - cashExpected;

    session.status = CashSessionStatus.CLOSED;
    session.closedByUserId = user.id;
    session.cashCounted = dto.cashCounted;
    session.difference = difference;
    session.notes = dto.notes ?? session.notes ?? '';
    session.closedAt = new Date();

    await this.sessionRepo.save(session);

    this.logger.log(
      `CIERRE Z — jornada ${session.date} por ${user.username}. ` +
        `Esperado: $${cashExpected} | Contado: $${dto.cashCounted} | ` +
        `Diferencia: ${difference >= 0 ? '+' : ''}$${difference}`,
    );

    const balances = difference === 0 ? 'exact' : difference > 0 ? 'surplus' : 'shortage';

    return { session, cashExpected, transferTotal, dayTotal: cashExpected + transferTotal, difference, balances };
  }

  // ─── KPIs de la Sesión Activa (para el Dashboard) ───────────────────────

  /**
   * KPIs de la jornada activa para el Dashboard Admin.
   * Fuente de verdad: la sesión OPEN actualmente (no el día calendario).
   * Si no hay sesión abierta → devuelve ceros.
   */
  async getActiveSessionKpis(): Promise<{
    sessionId: string | null;
    sessionDate: string | null;
    totalRevenue: number;
    cashTotal: number;
    transferTotal: number;
    completedBookings: number;
    totalSlots: number;
    occupationRate: number;
    productsSold: number;
  }> {
    // Buscar sesión abierta
    const openSession = await this.sessionRepo.findOne({
      where: { status: CashSessionStatus.OPEN },
      order: { openedAt: 'DESC' } as any,
    });

    if (!openSession) {
      return {
        sessionId: null,
        sessionDate: null,
        totalRevenue: 0,
        cashTotal: 0,
        transferTotal: 0,
        completedBookings: 0,
        totalSlots: 0,
        occupationRate: 0,
        productsSold: 0,
      };
    }

    const sessionDate = openSession.date; // YYYY-MM-DD de la jornada comercial

    const [revenueRows, bookingRows, courtRows, productsRows] = await Promise.all([
      // Ingresos desde las transacciones de esta sesión
      this.dataSource.query<{ total: string; cash: string; transfer: string }[]>(
        `SELECT
           COALESCE(SUM(amount_cash + amount_transfer), 0) AS total,
           COALESCE(SUM(amount_cash),                  0) AS cash,
           COALESCE(SUM(amount_transfer),              0) AS transfer
         FROM transactions
         WHERE cash_session_id = $1`,
        [openSession.id],
      ),
      // Turnos completados de la fecha comercial de la sesión
      this.dataSource.query<{ completed: string }[]>(
        `SELECT COUNT(*) AS completed
         FROM bookings
         WHERE date = $1 AND status = 'completed'`,
        [sessionDate],
      ),
      // Canchas activas
      this.dataSource.query<{ court_count: string }[]>(
        `SELECT COUNT(*) AS court_count FROM courts WHERE is_active = true`,
      ),
      // Productos vendidos: ventas POS + consumos de turnos completados, ambos de la sesión
      this.dataSource.query<{ total_qty: string }[]>(
        `SELECT COALESCE(SUM(qty), 0) AS total_qty
         FROM (
           SELECT si.quantity AS qty
           FROM sale_items si
           JOIN sales     sa ON sa.id   = si.sale_id
           JOIN transactions t  ON t.reference_id = sa.id AND t.type = 'sale'
           WHERE t.cash_session_id = $1

           UNION ALL

           SELECT bi.quantity AS qty
           FROM booking_items bi
           JOIN bookings b ON b.id = bi.booking_id
           WHERE b.date = $2 AND b.status = 'completed'
         ) sub`,
        [openSession.id, sessionDate],
      ),
    ]);

    const completedBookings = parseInt(bookingRows[0]?.completed ?? '0', 10);
    const courtCount = parseInt(courtRows[0]?.court_count ?? '1', 10);
    const totalSlots = courtCount * 14; // 9hs a 22hs inclusive
    const occupationRate =
      totalSlots > 0 ? Math.round((completedBookings / totalSlots) * 100) : 0;

    return {
      sessionId: openSession.id,
      sessionDate,
      totalRevenue: parseFloat(revenueRows[0]?.total ?? '0'),
      cashTotal: parseFloat(revenueRows[0]?.cash ?? '0'),
      transferTotal: parseFloat(revenueRows[0]?.transfer ?? '0'),
      completedBookings,
      totalSlots,
      occupationRate,
      productsSold: parseInt(productsRows[0]?.total_qty ?? '0', 10),
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Retorna la fecha comercial vigente en zona horaria Argentina (YYYY-MM-DD).
   * Implementa el "Cutoff Time": horas entre 00:00 y 03:59 AM pertenecen al día anterior.
   */
  getCommercialDate(): string {
    const CUTOFF_HOUR = 4;
    const TZ = 'America/Argentina/Buenos_Aires';

    const now = new Date();
    const hourParts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const currentHour = parseInt(hourParts.find((p) => p.type === 'hour')?.value ?? '12', 10);

    if (currentHour < CUTOFF_HOUR) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday.toLocaleDateString('en-CA', { timeZone: TZ });
    }

    return now.toLocaleDateString('en-CA', { timeZone: TZ });
  }
}
