import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';

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
      // Regla de negocio: una caja abierta no tiene hora de corte.
      // Opera libremente hasta que el cajero la cierre de forma manual,
      // independientemente de que se haya cruzado la medianoche o el límite de las 02:00 AM.
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
      bookingClientName: string | null;
      bookingHour: string | null;
      bookingCourtName: string | null;
      bookingPriceAmount: string | null;
      saleTotal: string | null;
      bookingItems: { productName: string; quantity: number; unitPrice: number; total: number }[] | null;
      saleItems: { productName: string; quantity: number; unitPrice: number; total: number }[] | null;
    }[];
    isOpen: boolean;
    /** true cuando la sesión abierta pertenece a una jornada anterior al día comercial actual. */
    staleSession: boolean;
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
        staleSession: false,
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
         u.username            AS "createdByUsername",
         b.client_name         AS "bookingClientName",
         b.hour                AS "bookingHour",
         c.name                AS "bookingCourtName",
         b.price_amount::float AS "bookingPriceAmount",
         s.total::float        AS "saleTotal",
         (
           SELECT json_agg(
             json_build_object(
               'productName', p.name,
               'quantity',    bi.quantity,
               'unitPrice',   bi.unit_price::float8,
               'total',       (bi.quantity * bi.unit_price)::float8
             ) ORDER BY p.name
           )
           FROM booking_items bi
           JOIN products p ON p.id = bi.product_id
           WHERE bi.booking_id = t.reference_id AND t.type = 'booking'
         ) AS "bookingItems",
         (
           SELECT json_agg(
             json_build_object(
               'productName', p.name,
               'quantity',    si.quantity,
               'unitPrice',   si.unit_price::float8,
               'total',       (si.quantity * si.unit_price)::float8
             ) ORDER BY p.name
           )
           FROM sale_items si
           JOIN products p ON p.id = si.product_id
           WHERE si.sale_id = t.reference_id AND t.type = 'sale'
         ) AS "saleItems"
       FROM transactions t
       LEFT JOIN sales    s ON s.id = t.reference_id AND t.type = 'sale'
       LEFT JOIN bookings b ON b.id = t.reference_id AND t.type = 'booking'
       LEFT JOIN courts   c ON c.id = b.court_id
       LEFT JOIN users    u ON u.id = t.created_by_user_id
       WHERE t.cash_session_id = $1
       ORDER BY t.created_at DESC`,
      [session.id],
    );

    // Una caja abierta nunca es "atrasada": opera hasta que se cierre manualmente.
    const staleSession = false;

    return {
      session,
      cashExpected,
      transferTotal,
      dayTotal: cashExpected + transferTotal,
      initialBalance: Number(session.initialBalance) || 0,
      transactions,
      isOpen: session.status === CashSessionStatus.OPEN,
      staleSession,
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
    liveBookings: number;
    canceledBookings: number;
    totalOperations: number;
    totalSlots: number;
    occupationRate: number;
    cantinaItemsSold: number;
    cantinaRevenue: number;
    courtsRevenue: number;
    topProduct: { name: string; quantity: number } | null;
    averageTicket: number;
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
        liveBookings: 0,
        canceledBookings: 0,
        totalOperations: 0,
        totalSlots: 0,
        occupationRate: 0,
        cantinaItemsSold: 0,
        cantinaRevenue: 0,
        courtsRevenue: 0,
        topProduct: null,
        averageTicket: 0,
      };
    }

    const sessionDate = openSession.date; // YYYY-MM-DD de la jornada comercial

    const [
      revenueRows,
      bookingRows,
      liveBookingRows,
      canceledBookingRows,
      courtRows,
      cantinaItemsRows,
      cantinaRevenueRows,
      topProductRows,
    ] = await Promise.all([
        // Ingresos totales desde las transacciones de esta sesión
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
        // Turnos en juego en este momento
        this.dataSource.query<{ live: string }[]>(
          `SELECT COUNT(*) AS live
           FROM bookings
           WHERE date = $1 AND status = 'playing'`,
          [sessionDate],
        ),
        // Turnos cancelados de la fecha comercial
        this.dataSource.query<{ canceled: string }[]>(
          `SELECT COUNT(*) AS canceled
           FROM bookings
           WHERE date = $1 AND status = 'cancelled'`,
          [sessionDate],
        ),
        // Canchas activas
        this.dataSource.query<{ court_count: string }[]>(
          `SELECT COUNT(*) AS court_count FROM courts WHERE is_active = true`,
        ),
        // Unidades vendidas de cantina: ventas POS + consumos de turnos completados
        this.dataSource.query<{ total_qty: string }[]>(
          `SELECT COALESCE(SUM(qty), 0) AS total_qty
           FROM (
             SELECT si.quantity AS qty
             FROM sale_items si
             JOIN sales        sa ON sa.id = si.sale_id
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
        // Ingresos de cantina: monto de ventas POS + valor monetario de items de turnos
        this.dataSource.query<{ cantina_revenue: string }[]>(
          `SELECT
             COALESCE(
               (SELECT SUM(t.amount_cash + t.amount_transfer)
                FROM transactions t
                WHERE t.cash_session_id = $1 AND t.type = 'sale'),
             0) +
             COALESCE(
               (SELECT SUM(bi.unit_price * bi.quantity)
                FROM booking_items bi
                JOIN bookings b ON b.id = bi.booking_id
                WHERE b.date = $2 AND b.status = 'completed'),
             0) AS cantina_revenue`,
          [openSession.id, sessionDate],
        ),
        // Producto más vendido en la sesión (POS + consumos de turnos)
        this.dataSource.query<{ name: string; total_qty: string }[]>(
          `SELECT p.name, SUM(sub.qty) AS total_qty
           FROM (
             SELECT si.product_id, si.quantity AS qty
             FROM sale_items si
             JOIN sales        sa ON sa.id = si.sale_id
             JOIN transactions t  ON t.reference_id = sa.id AND t.type = 'sale'
             WHERE t.cash_session_id = $1

             UNION ALL

             SELECT bi.product_id, bi.quantity AS qty
             FROM booking_items bi
             JOIN bookings b ON b.id = bi.booking_id
             WHERE b.date = $2 AND b.status = 'completed'
           ) sub
           JOIN products p ON p.id = sub.product_id
           GROUP BY p.id, p.name
           ORDER BY total_qty DESC
           LIMIT 1`,
          [openSession.id, sessionDate],
        ),
      ]);

    const completedBookings = parseInt(bookingRows[0]?.completed ?? '0', 10);
    const liveBookings = parseInt(liveBookingRows[0]?.live ?? '0', 10);
    const canceledBookings = parseInt(canceledBookingRows[0]?.canceled ?? '0', 10);
    const cantinaItemsSold = parseInt(cantinaItemsRows[0]?.total_qty ?? '0', 10);
    const totalOperations = liveBookings + completedBookings + canceledBookings + cantinaItemsSold;

    const courtCount = parseInt(courtRows[0]?.court_count ?? '1', 10);
    const totalSlots = courtCount * 14; // 9hs a 22hs inclusive
    const occupationRate =
      totalSlots > 0 ? Math.round((completedBookings / totalSlots) * 100) : 0;

    const totalRevenue = parseFloat(revenueRows[0]?.total ?? '0');
    const cantinaRevenue = parseFloat(cantinaRevenueRows[0]?.cantina_revenue ?? '0');
    const topProductRow = topProductRows[0] ?? null;

    return {
      sessionId: openSession.id,
      sessionDate,
      totalRevenue,
      cashTotal: parseFloat(revenueRows[0]?.cash ?? '0'),
      transferTotal: parseFloat(revenueRows[0]?.transfer ?? '0'),
      completedBookings,
      liveBookings,
      canceledBookings,
      totalOperations,
      totalSlots,
      occupationRate,
      cantinaItemsSold,
      cantinaRevenue,
      courtsRevenue: Math.max(0, totalRevenue - cantinaRevenue),
      topProduct: topProductRow
        ? { name: topProductRow.name, quantity: parseInt(topProductRow.total_qty, 10) }
        : null,
      averageTicket: completedBookings > 0 ? totalRevenue / completedBookings : 0,
    };
  }

  // ─── Consolidado Diario (Cierre Z del Administrador) ────────────────────

  /**
   * Devuelve el resumen consolidado de TODAS las sesiones que pertenecen
   * al día comercial indicado (YYYY-MM-DD).
   *
   * - `totalExpected`: suma de (efectivo + transferencias) de todos los turnos.
   * - `totalCounted`: suma del efectivo físico contado, solo si TODOS los turnos
   *   ya están cerrados (si alguno sigue abierto → null).
   * - `sessions`: detalle por turno (cajero, horario, montos, diferencia).
   */
  async getDailySummary(date: string): Promise<{
    date: string;
    totalExpected: number;
    totalCounted: number | null;
    sessions: {
      sessionId: string;
      openedByName: string;
      openedAt: Date;
      closedAt: Date | null;
      status: CashSessionStatus;
      cashExpected: number;
      transferTotal: number;
      dayTotal: number;
      cashCounted: number | null;
      difference: number | null;
    }[];
  }> {
    const rows = await this.dataSource.query<
      {
        id: string;
        opened_at: Date;
        closed_at: Date | null;
        status: string;
        cash_counted: string | null;
        difference: string | null;
        opened_by_name: string | null;
        cash_expected: string;
        transfer_total: string;
      }[]
    >(
      `SELECT
         cs.id,
         cs.opened_at,
         cs.closed_at,
         cs.status,
         cs.cash_counted,
         cs.difference,
         COALESCE(u.full_name, u.username, 'Desconocido') AS opened_by_name,
         COALESCE(SUM(t.amount_cash),     0) AS cash_expected,
         COALESCE(SUM(t.amount_transfer), 0) AS transfer_total
       FROM cash_sessions cs
       LEFT JOIN users u        ON u.id  = cs.opened_by_user_id
       LEFT JOIN transactions t ON t.cash_session_id = cs.id
       WHERE cs.date = $1
       GROUP BY cs.id, u.full_name, u.username
       ORDER BY cs.opened_at ASC`,
      [date],
    );

    const sessions = rows.map((row) => {
      const cashExpected = parseFloat(row.cash_expected);
      const transferTotal = parseFloat(row.transfer_total);
      return {
        sessionId: row.id,
        openedByName: row.opened_by_name ?? 'Desconocido',
        openedAt: row.opened_at,
        closedAt: row.closed_at,
        status: row.status as CashSessionStatus,
        cashExpected,
        transferTotal,
        dayTotal: cashExpected + transferTotal,
        cashCounted: row.cash_counted != null ? parseFloat(row.cash_counted) : null,
        difference: row.difference != null ? parseFloat(row.difference) : null,
      };
    });

    const totalExpected = sessions.reduce((s, sess) => s + sess.dayTotal, 0);
    // totalCounted solo tiene sentido cuando todos los turnos están cerrados
    const allClosed = sessions.every((s) => s.cashCounted !== null);
    const totalCounted = allClosed
      ? sessions.reduce((s, sess) => s + (sess.cashCounted ?? 0), 0)
      : null;

    return { date, totalExpected, totalCounted, sessions };
  }

  // ─── Exportación Excel ───────────────────────────────────────────────────

  /**
   * Genera el Excel de Cierre X (turno específico).
   * Hoja 1: Resumen de la sesión (cajero, fechas, totales, diferencia).
   * Hoja 2: Detalle de transacciones (ventas y turnos).
   */
  async generateSessionExcel(sessionId: string): Promise<Buffer> {
    const sessionRows = await this.dataSource.query<
      {
        id: string;
        date: string;
        status: string;
        opened_at: Date;
        closed_at: Date | null;
        initial_balance: string;
        cash_counted: string | null;
        difference: string | null;
        notes: string | null;
        opened_by_name: string;
        closed_by_name: string | null;
      }[]
    >(
      `SELECT
         cs.id,
         cs.date,
         cs.status,
         cs.opened_at,
         cs.closed_at,
         cs.initial_balance,
         cs.cash_counted,
         cs.difference,
         cs.notes,
         COALESCE(ub.full_name, ub.username, 'Desconocido') AS opened_by_name,
         COALESCE(uc.full_name, uc.username)                 AS closed_by_name
       FROM cash_sessions cs
       LEFT JOIN users ub ON ub.id = cs.opened_by_user_id
       LEFT JOIN users uc ON uc.id = cs.closed_by_user_id
       WHERE cs.id = $1`,
      [sessionId],
    );

    if (!sessionRows.length) {
      throw new NotFoundException(`No se encontró la sesión de caja con id ${sessionId}.`);
    }

    const s = sessionRows[0];
    const cashExpected = await this.dataSource.query<{ cash: string; transfer: string }[]>(
      `SELECT
         COALESCE(SUM(amount_cash),     0) AS cash,
         COALESCE(SUM(amount_transfer), 0) AS transfer
       FROM transactions WHERE cash_session_id = $1`,
      [sessionId],
    );
    const efectivo = parseFloat(cashExpected[0]?.cash ?? '0');
    const transferencia = parseFloat(cashExpected[0]?.transfer ?? '0');
    const totalSistema = efectivo + transferencia;
    const cashCounted = s.cash_counted != null ? parseFloat(s.cash_counted) : null;
    const difference = s.difference != null ? parseFloat(s.difference) : null;

    const transactions = await this.dataSource.query<
      {
        created_at: Date;
        type: string;
        concept: string;
        amount_cash: string;
        amount_transfer: string;
        customer_name: string | null;
        created_by_name: string | null;
      }[]
    >(
      `SELECT
         t.created_at,
         t.type,
         t.concept,
         t.amount_cash,
         t.amount_transfer,
         s.customer_name,
         COALESCE(u.full_name, u.username) AS created_by_name
       FROM transactions t
       LEFT JOIN users u ON u.id = t.created_by_user_id
       LEFT JOIN sales s ON s.id = t.reference_id AND t.type = 'sale'
       WHERE t.cash_session_id = $1
       ORDER BY t.created_at ASC`,
      [sessionId],
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = 'PadelSys';
    wb.created = new Date();

    // ── Hoja 1: Resumen ──
    const wsR = wb.addWorksheet('Resumen');
    wsR.columns = [
      { key: 'label', width: 34 },
      { key: 'value', width: 30 },
    ];

    const fmtDate = (d: Date | null) =>
      d ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const fmtNum = (n: number) =>
      n.toLocaleString('es-AR', { minimumFractionDigits: 2 });

    const titleRow = wsR.addRow(['CIERRE DE TURNO X — INFORME DE SESIÓN']);
    titleRow.font = { bold: true, size: 14 };
    titleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a7f4b' } };
    titleRow.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    wsR.mergeCells('A1:B1');
    wsR.addRow([]);

    const addSection = (title: string) => {
      const row = wsR.addRow([title]);
      row.font = { bold: true, size: 11, color: { argb: 'FF1a7f4b' } };
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFe6f4ec' } };
      wsR.mergeCells(`A${row.number}:B${row.number}`);
    };

    const addRow = (label: string, value: string) => {
      const row = wsR.addRow([label, value]);
      row.getCell(1).font = { bold: true };
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8f8f8' } };
    };

    addSection('DATOS DE LA SESIÓN');
    addRow('Jornada (fecha comercial)', s.date);
    addRow('Apertura', fmtDate(s.opened_at));
    addRow('Cierre', fmtDate(s.closed_at));
    addRow('Estado', s.status === 'open' ? 'Abierto' : 'Cerrado');
    addRow('Abierto por', s.opened_by_name);
    addRow('Cerrado por', s.closed_by_name ?? '(turno aún abierto)');
    wsR.addRow([]);

    addSection('RESUMEN FINANCIERO');
    addRow('Fondo inicial (cambio)', `$ ${fmtNum(parseFloat(s.initial_balance ?? '0'))}`);
    addRow('Efectivo generado (sistema)', `$ ${fmtNum(efectivo)}`);
    addRow('Transferencias', `$ ${fmtNum(transferencia)}`);
    addRow('Total sistema', `$ ${fmtNum(totalSistema)}`);
    wsR.addRow([]);

    addSection('ARQUEO FÍSICO');
    addRow('Efectivo contado', cashCounted != null ? `$ ${fmtNum(cashCounted)}` : '(turno aún abierto)');
    addRow('Diferencia', difference != null ? `$ ${fmtNum(difference)}` : '—');
    addRow(
      'Estado del arqueo',
      difference == null
        ? '—'
        : difference === 0
          ? 'Cuadra ✓'
          : difference > 0
            ? `Sobrante de $ ${fmtNum(Math.abs(difference))}`
            : `Faltante de $ ${fmtNum(Math.abs(difference))}`,
    );
    wsR.addRow([]);

    const notasX = s.notes?.trim() ?? '';
    if (notasX) {
      addSection('OBSERVACIONES');
      addRow('Notas de cierre', notasX);
    }

    // Bordes en todas las celdas con datos
    wsR.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFdddddd' } },
          bottom: { style: 'thin', color: { argb: 'FFdddddd' } },
          left: { style: 'thin', color: { argb: 'FFdddddd' } },
          right: { style: 'thin', color: { argb: 'FFdddddd' } },
        };
        cell.alignment = { vertical: 'middle', wrapText: false };
      });
    });

    // ── Hoja 2: Transacciones ──
    const wsT = wb.addWorksheet('Detalle de Transacciones');
    wsT.columns = [
      { header: 'Hora', key: 'hora', width: 10 },
      { header: 'Tipo', key: 'tipo', width: 12 },
      { header: 'Descripción', key: 'desc', width: 42 },
      { header: 'Cliente', key: 'cliente', width: 24 },
      { header: 'Cajero', key: 'cajero', width: 24 },
      { header: 'Efectivo ($)', key: 'cash', width: 15 },
      { header: 'Transferencia ($)', key: 'transfer', width: 18 },
      { header: 'Total ($)', key: 'total', width: 14 },
    ];

    // Cabecera con estilo
    const headerRow = wsT.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a7f4b' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        bottom: { style: 'medium', color: { argb: 'FF0f5c34' } },
      };
    });

    for (const tx of transactions) {
      const cash = parseFloat(tx.amount_cash);
      const transfer = parseFloat(tx.amount_transfer);
      const row = wsT.addRow({
        hora: new Date(tx.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }),
        tipo: tx.type === 'booking' ? 'Turno' : 'Venta',
        desc: tx.concept,
        cliente: tx.customer_name ?? '—',
        cajero: tx.created_by_name ?? '—',
        cash,
        transfer,
        total: cash + transfer,
      });

      // Formato moneda en las columnas numéricas
      ['cash', 'transfer', 'total'].forEach((key) => {
        const cell = row.getCell(key);
        cell.numFmt = '"$"#,##0.00';
        cell.alignment = { horizontal: 'right' };
      });

      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFeeeeee' } },
          bottom: { style: 'thin', color: { argb: 'FFeeeeee' } },
          left: { style: 'thin', color: { argb: 'FFeeeeee' } },
          right: { style: 'thin', color: { argb: 'FFeeeeee' } },
        };
      });
    }

    // Fila de totales
    if (transactions.length > 0) {
      wsT.addRow([]);
      const totalRow = wsT.addRow({
        hora: '',
        tipo: '',
        desc: 'TOTAL',
        cliente: '',
        cajero: '',
        cash: efectivo,
        transfer: transferencia,
        total: totalSistema,
      });
      totalRow.font = { bold: true };
      totalRow.getCell('desc').font = { bold: true };
      ['cash', 'transfer', 'total'].forEach((key) => {
        const cell = totalRow.getCell(key);
        cell.numFmt = '"$"#,##0.00';
        cell.alignment = { horizontal: 'right' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFe6f4ec' } };
      });
    }

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer as ArrayBuffer);
  }

  /**
   * Genera el Excel de Cierre Z Consolidado (jornada completa).
   * Hoja 1: Resumen del día con totales globales.
   * Hoja 2: Detalle de cada turno con sus montos.
   */
  async generateDailyExcel(date: string): Promise<Buffer> {
    const rows = await this.dataSource.query<
      {
        id: string;
        opened_at: Date;
        closed_at: Date | null;
        status: string;
        initial_balance: string;
        cash_counted: string | null;
        difference: string | null;
        notes: string | null;
        opened_by_name: string;
        closed_by_name: string | null;
        cash_expected: string;
        transfer_total: string;
      }[]
    >(
      `SELECT
         cs.id,
         cs.opened_at,
         cs.closed_at,
         cs.status,
         cs.initial_balance,
         cs.cash_counted,
         cs.difference,
         cs.notes,
         COALESCE(ub.full_name, ub.username, 'Desconocido') AS opened_by_name,
         COALESCE(uc.full_name, uc.username)                 AS closed_by_name,
         COALESCE(SUM(t.amount_cash),     0)                 AS cash_expected,
         COALESCE(SUM(t.amount_transfer), 0)                 AS transfer_total
       FROM cash_sessions cs
       LEFT JOIN users ub       ON ub.id = cs.opened_by_user_id
       LEFT JOIN users uc       ON uc.id = cs.closed_by_user_id
       LEFT JOIN transactions t ON t.cash_session_id = cs.id
       WHERE cs.date = $1
       GROUP BY cs.id, ub.full_name, ub.username, uc.full_name, uc.username
       ORDER BY cs.opened_at ASC`,
      [date],
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = 'PadelSys';
    wb.created = new Date();

    const fmtDate = (d: Date | null) =>
      d ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const fmtNum = (n: number) =>
      n.toLocaleString('es-AR', { minimumFractionDigits: 2 });

    const totalEfectivo = rows.reduce((s, r) => s + parseFloat(r.cash_expected), 0);
    const totalTransfer = rows.reduce((s, r) => s + parseFloat(r.transfer_total), 0);
    const totalDia = totalEfectivo + totalTransfer;
    const allClosed = rows.every((r) => r.status === 'closed');
    const totalContado = allClosed
      ? rows.reduce((s, r) => s + (r.cash_counted != null ? parseFloat(r.cash_counted) : 0), 0)
      : null;

    // Fecha legible
    const [yr, mo, dy] = date.split('-').map(Number);
    const dateLabel = new Date(yr, mo - 1, dy).toLocaleDateString('es-AR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

    // ── Hoja 1: Resumen del Día ──
    const wsR = wb.addWorksheet('Resumen del Día');
    wsR.columns = [
      { key: 'label', width: 36 },
      { key: 'value', width: 30 },
    ];

    const titleRow = wsR.addRow([`CIERRE Z — CONSOLIDADO DEL ${dateLabel.toUpperCase()}`]);
    titleRow.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    titleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a7f4b' } };
    wsR.mergeCells('A1:B1');
    wsR.addRow([]);

    const addSection = (title: string) => {
      const row = wsR.addRow([title]);
      row.font = { bold: true, size: 11, color: { argb: 'FF1a7f4b' } };
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFe6f4ec' } };
      wsR.mergeCells(`A${row.number}:B${row.number}`);
    };

    const addRow = (label: string, value: string) => {
      const row = wsR.addRow([label, value]);
      row.getCell(1).font = { bold: true };
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8f8f8' } };
    };

    addSection('TOTALES DE LA JORNADA');
    addRow('Fecha comercial', date);
    addRow('Cantidad de turnos', String(rows.length));
    addRow('Efectivo total (sistema)', `$ ${fmtNum(totalEfectivo)}`);
    addRow('Transferencias totales', `$ ${fmtNum(totalTransfer)}`);
    addRow('Recaudación total del día', `$ ${fmtNum(totalDia)}`);
    addRow(
      'Arqueo físico total',
      totalContado != null ? `$ ${fmtNum(totalContado)}` : '(hay turnos aún abiertos)',
    );
    wsR.addRow([]);

    addSection('DETALLE POR TURNO');
    rows.forEach((r, i) => {
      const ef = parseFloat(r.cash_expected);
      const tr = parseFloat(r.transfer_total);
      wsR.addRow([]);
      const shiftTitle = wsR.addRow([`Turno ${i + 1} — ${r.opened_by_name}`]);
      shiftTitle.font = { bold: true, italic: true };
      wsR.mergeCells(`A${shiftTitle.number}:B${shiftTitle.number}`);
      addRow('Abierto por', r.opened_by_name);
      addRow('Cerrado por', r.closed_by_name ?? '(turno aún abierto)');
      addRow('Apertura', fmtDate(r.opened_at));
      addRow('Cierre', fmtDate(r.closed_at));
      addRow('Estado', r.status === 'open' ? 'Abierto' : 'Cerrado');
      addRow('Efectivo (sistema)', `$ ${fmtNum(ef)}`);
      addRow('Transferencias', `$ ${fmtNum(tr)}`);
      addRow('Total turno', `$ ${fmtNum(ef + tr)}`);
      if (r.cash_counted != null) {
        addRow('Efectivo contado', `$ ${fmtNum(parseFloat(r.cash_counted))}`);
        const diff = parseFloat(r.difference ?? '0');
        addRow(
          'Diferencia',
          diff === 0 ? 'Cuadra ✓' : diff > 0 ? `+$ ${fmtNum(diff)}` : `−$ ${fmtNum(Math.abs(diff))}`,
        );
      }
      const notasZ = r.notes?.trim() ?? '';
      if (notasZ) addRow('Notas', notasZ);
    });

    wsR.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFdddddd' } },
          bottom: { style: 'thin', color: { argb: 'FFdddddd' } },
          left: { style: 'thin', color: { argb: 'FFdddddd' } },
          right: { style: 'thin', color: { argb: 'FFdddddd' } },
        };
        cell.alignment = { vertical: 'middle', wrapText: false };
      });
    });

    // ── Hoja 2: Desglose por Turno ──
    const wsS = wb.addWorksheet('Desglose por Turno');
    wsS.columns = [
      { header: 'Turno #', key: 'num', width: 9 },
      { header: 'Abierto por', key: 'abiertoPor', width: 26 },
      { header: 'Cerrado por', key: 'cerradoPor', width: 26 },
      { header: 'Apertura', key: 'apertura', width: 20 },
      { header: 'Cierre', key: 'cierre', width: 20 },
      { header: 'Estado', key: 'estado', width: 12 },
      { header: 'Efectivo ($)', key: 'cash', width: 16 },
      { header: 'Transferencia ($)', key: 'transfer', width: 18 },
      { header: 'Total Turno ($)', key: 'total', width: 16 },
      { header: 'Contado ($)', key: 'contado', width: 14 },
      { header: 'Diferencia ($)', key: 'diff', width: 15 },
    ];

    const headerRow = wsS.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a7f4b' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF0f5c34' } } };
    });

    rows.forEach((r, i) => {
      const ef = parseFloat(r.cash_expected);
      const tr = parseFloat(r.transfer_total);
      const contado = r.cash_counted != null ? parseFloat(r.cash_counted) : null;
      const diff = r.difference != null ? parseFloat(r.difference) : null;

      const row = wsS.addRow({
        num: i + 1,
        abiertoPor: r.opened_by_name,
        cerradoPor: r.closed_by_name ?? '(abierto)',
        apertura: fmtDate(r.opened_at),
        cierre: fmtDate(r.closed_at),
        estado: r.status === 'open' ? 'Abierto' : 'Cerrado',
        cash: ef,
        transfer: tr,
        total: ef + tr,
        contado: contado ?? '—',
        diff: diff != null ? diff : '—',
      });

      ['cash', 'transfer', 'total'].forEach((key) => {
        const cell = row.getCell(key);
        cell.numFmt = '"$"#,##0.00';
        cell.alignment = { horizontal: 'right' };
      });

      if (contado != null) {
        row.getCell('contado').numFmt = '"$"#,##0.00';
        row.getCell('contado').alignment = { horizontal: 'right' };
      }
      if (diff != null) {
        row.getCell('diff').numFmt = '"$"#,##0.00';
        row.getCell('diff').alignment = { horizontal: 'right' };
        if (diff < 0) row.getCell('diff').font = { color: { argb: 'FFCC0000' } };
        if (diff > 0) row.getCell('diff').font = { color: { argb: 'FF1565C0' } };
      }

      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFeeeeee' } },
          bottom: { style: 'thin', color: { argb: 'FFeeeeee' } },
          left: { style: 'thin', color: { argb: 'FFeeeeee' } },
          right: { style: 'thin', color: { argb: 'FFeeeeee' } },
        };
      });
    });

    // Fila de totales
    wsS.addRow([]);
    const totRow = wsS.addRow({
      num: '',
      abiertoPor: 'TOTAL',
      cerradoPor: '',
      apertura: '',
      cierre: '',
      estado: '',
      cash: totalEfectivo,
      transfer: totalTransfer,
      total: totalDia,
      contado: totalContado ?? '—',
      diff: '',
    });
    totRow.font = { bold: true };
    ['cash', 'transfer', 'total'].forEach((key) => {
      const cell = totRow.getCell(key);
      cell.numFmt = '"$"#,##0.00';
      cell.alignment = { horizontal: 'right' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFe6f4ec' } };
    });
    if (totalContado != null) {
      totRow.getCell('contado').numFmt = '"$"#,##0.00';
      totRow.getCell('contado').alignment = { horizontal: 'right' };
      totRow.getCell('contado').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFe6f4ec' } };
    }

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer as ArrayBuffer);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Retorna la fecha comercial vigente en zona horaria Argentina (YYYY-MM-DD).
   * Implementa el "Cutoff Time": horas entre 00:00 y 01:59 AM pertenecen al día anterior.
   * El complejo cierra a la 01:00 AM y se da 1 hora de margen administrativo.
   * Ej: Sábado 01:30 AM → jornada del Viernes. Sábado 02:00 AM → jornada del Sábado.
   *
   * REGLA CRÍTICA: Esta función SOLO se usa al ABRIR una nueva sesión.
   * Una sesión ya OPEN conserva su fecha original de forma inmutable.
   */
  getCommercialDate(): string {
    const CUTOFF_HOUR = 2;
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
