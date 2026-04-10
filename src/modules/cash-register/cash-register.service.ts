import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThanOrEqual, QueryRunner, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';

import { CashSession, CashSessionStatus } from './entities/cash-session.entity';
import { Transaction, TransactionType } from './entities/transaction.entity';
import { DailyClosureRecord } from './entities/daily-closure.entity';
import { User } from '../users/entities/user.entity';
import { CloseSessionDto } from './dto/close-session.dto';
import { OpenSessionDto } from './dto/open-session.dto';

export interface RegisterTransactionInput {
  cashSessionId: string | null;
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

    @InjectRepository(DailyClosureRecord)
    private readonly dailyClosureRepo: Repository<DailyClosureRecord>,
  ) {}

  /**
   * Abre una nueva sesión de caja manualmente.
   * Requiere que no exista ninguna sesión OPEN en este momento.
   * Registra el fondo de caja / cambio inicial declarado por el empleado.
   */
  async openSession(dto: OpenSessionDto, user: User): Promise<CashSession> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      await qr.query(`SELECT pg_advisory_xact_lock(abs(hashtext($1)))`, ['cash_session:open']);

      const existing = await qr.manager.findOne(CashSession, {
        where: { status: CashSessionStatus.OPEN },
        lock: { mode: 'pessimistic_read' },
        order: { openedAt: 'DESC' } as any,
      });

      if (existing) {
        throw new ConflictException(
          'Ya existe una sesión de caja abierta. Cerrá la jornada actual antes de abrir una nueva.',
        );
      }

      let commercialDate = this.getBusinessDate();

      const orphanedDays: { date: string }[] = await qr.query(
        `SELECT DISTINCT cs.date
         FROM cash_sessions cs
         WHERE cs.status = 'closed'
           AND cs.date < $1
           AND NOT EXISTS (
             SELECT 1 FROM daily_closures dc WHERE dc.date = cs.date
           )
         ORDER BY cs.date ASC
         LIMIT 1`,
        [commercialDate],
      );

      if (orphanedDays.length > 0) {
        throw new ConflictException(
          `No podés abrir un nuevo turno. La jornada del ${orphanedDays[0].date} está pendiente de cierre. ` +
            `Finalizá esa jornada antes de continuar.`,
        );
      }

      const dayAlreadyClosed = await qr.manager.findOne(DailyClosureRecord, {
        where: { date: commercialDate },
      });
      if (dayAlreadyClosed) {
        const originalDate = commercialDate;
        const [y, m, d] = commercialDate.split('-').map(Number);
        const next = new Date(y, m - 1, d + 1);
        commercialDate = [
          next.getFullYear(),
          String(next.getMonth() + 1).padStart(2, '0'),
          String(next.getDate()).padStart(2, '0'),
        ].join('-');
        this.logger.log(
          `Cierre de Jornada detectado para ${originalDate} — nueva jornada imputada al día siguiente: ${commercialDate}`,
        );
      }

      const session = qr.manager.create(CashSession, {
        date: commercialDate,
        status: CashSessionStatus.OPEN,
        openedByUserId: user.id,
        initialBalance: dto.initialBalance,
        notes: dto.notes || undefined,
      });

      const saved = await qr.manager.save(CashSession, session);

      // Sweep: asignar transacciones huérfanas (confirmaciones de seña sin caja abierta)
      const sweepResult = await qr.query(
        `UPDATE transactions
         SET cash_session_id = $1
         WHERE cash_session_id IS NULL`,
        [saved.id],
      );
      const sweptCount = sweepResult[1] ?? sweepResult?.rowCount ?? 0;
      if (sweptCount > 0) {
        this.logger.log(
          `Sweep al abrir caja: ${sweptCount} transacción(es) huérfana(s) asignada(s) a sesión ${saved.id}`,
        );
      }

      await qr.commitTransaction();

      this.logger.log(
        `Caja abierta por ${user.username} | Jornada ${commercialDate} | Fondo inicial: $${dto.initialBalance}`,
      );
      return saved;
    } catch (err: any) {
      await qr.rollbackTransaction();
      if (err?.code === '23505') {
        throw new ConflictException(
          'Ya existe una sesión registrada para esta jornada. Ejecuta la migración "DropUniqueDateCashSessions" para permitir múltiples jornadas por día.',
        );
      }
      throw err;
    } finally {
      await qr.release();
    }
  }

  /**
   * Obtiene la sesión de caja ABIERTA actualmente.
   * Si no existe ninguna sesión abierta lanza un error —
   * el empleado debe abrir la caja antes de registrar cualquier cobro.
   *
   * Debe llamarse dentro de un QueryRunner activo.
   */
  async getActiveSessionOrFail(queryRunner: QueryRunner, userId: string): Promise<CashSession> {
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

    throw new BadRequestException({
      errorCode: 'CAJA_CERRADA',
      message: 'Debes abrir la caja antes de registrar cualquier cobro o venta.',
    });
  }

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

  /**
   * Retorna el estado completo de la sesión de caja:
   *  - Sin ?date → busca ÚNICAMENTE la sesión OPEN activa.
   *               Si no hay ninguna abierta → session: null (mostrar pantalla de Apertura).
   *  - Con ?date → consulta histórica exacta para esa fecha (puede ser CLOSED).
   */
  async getCurrentSession(date?: string): Promise<{
    session: CashSession | null;
    cashIncome: number;
    cashExpenseTotal: number;
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
      bookingItems:
        | { productName: string; quantity: number; unitPrice: number; total: number }[]
        | null;
      saleItems:
        | { productName: string; quantity: number; unitPrice: number; total: number }[]
        | null;
      expenseCategory: string | null;
    }[];
    isOpen: boolean;
    /** true cuando la sesión abierta pertenece a una jornada anterior al día comercial actual. */
    staleSession: boolean;
    /**
     * true cuando la jornada comercial de la sesión activa (o la fecha comercial actual
     * si no hay sesión) ya fue cerrada formalmente vía "Cierre de Jornada".
     * Se persiste en la tabla daily_closures para ser la fuente de verdad del backend.
     */
    isBusinessDayClosed: boolean;
  }> {
    let session: CashSession | null;

    const userSelect = { id: true, username: true, fullName: true, role: true } as const;
    const sessionSelect = {
      id: true,
      date: true,
      status: true,
      openedAt: true,
      closedAt: true,
      initialBalance: true,
      cashCounted: true,
      difference: true,
      notes: true,
      openedByUserId: true,
      closedByUserId: true,
      openedByUser: userSelect,
      closedByUser: userSelect,
    } as const;

    if (date) {
      session = await this.sessionRepo.findOne({
        where: { date },
        select: sessionSelect,
        relations: ['openedByUser', 'closedByUser'],
      });
    } else {
      session = await this.sessionRepo.findOne({
        where: { status: CashSessionStatus.OPEN },
        select: sessionSelect,
        order: { openedAt: 'DESC' } as any,
        relations: ['openedByUser', 'closedByUser'],
      });

      if (!session) {
        const commercialDayStart = this.getCommercialDayStart();
        session = await this.sessionRepo.findOne({
          where: {
            status: CashSessionStatus.CLOSED,
            closedAt: MoreThanOrEqual(commercialDayStart),
          },
          select: sessionSelect,
          order: { closedAt: 'DESC' } as any,
          relations: ['openedByUser', 'closedByUser'],
        });
      }
    }

    if (!session) {
      const noSessCommercialDate = this.getBusinessDate();
      const noSessClosureRecord = await this.dailyClosureRepo.findOne({
        where: { date: noSessCommercialDate },
      });
      return {
        session: null,
        cashIncome: 0,
        cashExpenseTotal: 0,
        cashExpected: 0,
        transferTotal: 0,
        dayTotal: 0,
        initialBalance: 0,
        transactions: [],
        isOpen: false,
        staleSession: false,
        isBusinessDayClosed: !!noSessClosureRecord,
      };
    }

    const totals = await this.dataSource.query<
      {
        cash_income: string;
        cash_expense_total: string;
        cash_expected: string;
        transfer_total: string;
      }[]
    >(
      `SELECT
         COALESCE(SUM(amount_cash), 0)                                          AS cash_income,
         COALESCE((SELECT SUM(amount) FROM expenses
                   WHERE cash_session_id = $1 AND deleted_at IS NULL), 0)       AS cash_expense_total,
         COALESCE(SUM(amount_cash), 0)
           - COALESCE((SELECT SUM(amount) FROM expenses
                       WHERE cash_session_id = $1 AND deleted_at IS NULL), 0)   AS cash_expected,
         COALESCE(SUM(amount_transfer), 0)                                      AS transfer_total
       FROM transactions
       WHERE cash_session_id = $1`,
      [session.id],
    );

    const cashIncome = parseFloat(totals[0]?.cash_income ?? '0');
    const cashExpenseTotal = parseFloat(totals[0]?.cash_expense_total ?? '0');
    const cashExpected = parseFloat(totals[0]?.cash_expected ?? '0');
    const transferTotal = parseFloat(totals[0]?.transfer_total ?? '0');

    const transactions = await this.dataSource.query(
      `SELECT
         t.id,
         t.type::text,
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
         ) AS "saleItems",
         NULL::text            AS "expenseCategory"
       FROM transactions t
       LEFT JOIN sales    s ON s.id = t.reference_id AND t.type = 'sale'
       LEFT JOIN bookings b ON b.id = t.reference_id AND t.type = 'booking'
       LEFT JOIN courts   c ON c.id = b.court_id
       LEFT JOIN users    u ON u.id = t.created_by_user_id
       WHERE t.cash_session_id = $1

       UNION ALL

       SELECT
         e.id,
         'expense'::text        AS type,
         e.id                  AS "referenceId",
         e.description         AS concept,
         e.amount::float       AS "amountCash",
         0::float              AS "amountTransfer",
         e.created_at          AS "createdAt",
         NULL                  AS "customerName",
         NULL                  AS "createdByFullName",
         NULL                  AS "createdByUsername",
         NULL                  AS "bookingClientName",
         NULL                  AS "bookingHour",
         NULL                  AS "bookingCourtName",
         NULL::float           AS "bookingPriceAmount",
         NULL::float           AS "saleTotal",
         NULL::json            AS "bookingItems",
         NULL::json            AS "saleItems",
         e.category::text       AS "expenseCategory"
       FROM expenses e
       WHERE e.cash_session_id = $1 AND e.deleted_at IS NULL

       ORDER BY "createdAt" DESC`,
      [session.id],
    );

    const currentBusinessDate = this.getBusinessDate();
    const staleSession =
      session.status === CashSessionStatus.OPEN && session.date !== currentBusinessDate;

    const closureLookupDate = date ? session.date : currentBusinessDate;
    const closureRecord = await this.dailyClosureRepo.findOne({
      where: { date: closureLookupDate },
    });

    return {
      session,
      cashIncome,
      cashExpenseTotal,
      cashExpected,
      transferTotal,
      dayTotal: cashExpected + transferTotal,
      initialBalance: Number(session.initialBalance) || 0,
      transactions,
      isOpen: session.status === CashSessionStatus.OPEN,
      staleSession,
      isBusinessDayClosed: !!closureRecord,
    };
  }

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

    const totals = await this.dataSource.query<
      {
        cash_income: string;
        cash_expense_total: string;
        transfer_total: string;
      }[]
    >(
      `SELECT
         COALESCE(SUM(amount_cash), 0)                                        AS cash_income,
         COALESCE((SELECT SUM(amount) FROM expenses
                   WHERE cash_session_id = $1 AND deleted_at IS NULL), 0)     AS cash_expense_total,
         COALESCE(SUM(amount_transfer), 0)                                    AS transfer_total
       FROM transactions
       WHERE cash_session_id = $1`,
      [session.id],
    );

    const cashIncome = parseFloat(totals[0]?.cash_income ?? '0');
    const cashExpenseTotal = parseFloat(totals[0]?.cash_expense_total ?? '0');
    const transferTotal = parseFloat(totals[0]?.transfer_total ?? '0');
    const initialBalance = Number(session.initialBalance) || 0;
    const cashExpected = Math.max(0, cashIncome - cashExpenseTotal);
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
        `Fondo: $${initialBalance} | Ingresos: $${cashIncome} | Egresos: $${cashExpenseTotal} | ` +
        `Esperado: $${cashExpected} | Contado: $${dto.cashCounted} | ` +
        `Diferencia: ${difference >= 0 ? '+' : ''}$${difference}`,
    );

    const balances = difference === 0 ? 'exact' : difference > 0 ? 'surplus' : 'shortage';

    return {
      session,
      cashExpected,
      transferTotal,
      dayTotal: cashExpected + transferTotal,
      difference,
      balances,
    };
  }

  /**
   * Devuelve el `cashCounted` del último turno cerrado, para pre-cargar el
   * "Fondo Inicial" del próximo turno (arrastre de fondo).
   * Retorna `null` si nunca hubo ningún turno cerrado.
   */
  async getLastClosedSuggestion(): Promise<{ cashCounted: number | null }> {
    const session = await this.sessionRepo.findOne({
      where: { status: CashSessionStatus.CLOSED },
      order: { closedAt: 'DESC' } as any,
    });
    return {
      cashCounted: session?.cashCounted != null ? Number(session.cashCounted) : null,
    };
  }

  /**
   * Verifica si hay pendientes que viajarán al siguiente turno:
   * - Bookings con status 'playing' de la jornada comercial actual.
   * - Ventas sin cobrar (actualmente siempre 0, ya que POS exige pago completo).
   * Se usa para mostrar un modal de advertencia antes del cierre.
   */
  async checkPendings(): Promise<{ pendingBookings: number; unpaidSales: number }> {
    const businessDate = this.getBusinessDate();

    const result = await this.dataSource.query<{ pending_bookings: string }[]>(
      `SELECT COUNT(*) AS pending_bookings
       FROM bookings
       WHERE date = $1
         AND (
           status = 'playing'
           OR (
             status = 'booked'
             AND (date || ' ' || hour || ':00')::timestamp
                 < NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires'
           )
         )`,
      [businessDate],
    );

    return {
      pendingBookings: parseInt(result[0]?.pending_bookings ?? '0', 10),
      unpaidSales: 0,
    };
  }

  /**
   * Finaliza la Jornada Comercial activa.
   *
   * Estrategia de fecha contable — agrupación estricta por `date`:
   *   Busca todas las sesiones CERRADAS que aún no tienen un DailyClosureRecord
   *   para su fecha contable (sesiones "huérfanas"). Las agrupa por `date` y cierra
   *   ÚNICAMENTE las de la fecha más antigua. Esto garantiza:
   *     a) Que nunca se fusionen sesiones de días distintos en un mismo cierre.
   *     b) Que si hay acumulación (días olvidados), se cierren en orden cronológico,
   *        forzando al operador a repetir la acción una vez por cada jornada pendiente.
   *
   *   La guardia en `openSession` previene la acumulación en condiciones normales.
   *   Este método es el segundo nivel de defensa.
   */
  async closeDay(): Promise<{
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
    const { pendingBookings } = await this.checkPendings();
    if (pendingBookings > 0) {
      throw new ConflictException(
        'No se puede cerrar la caja. Hay turnos en curso o sin finalizar.',
      );
    }

    const openSession = await this.sessionRepo.findOne({
      where: { status: CashSessionStatus.OPEN },
    });

    if (openSession) {
      throw new ConflictException(
        'Hay un turno de caja abierto. Cerrá el turno actual antes de realizar el Cierre de Jornada.',
      );
    }

    const allOrphanedRows = await this.dataSource.query<
      {
        id: string;
        date: string;
        opened_at: Date;
        closed_at: Date | null;
        status: string;
        initial_balance: string;
        cash_counted: string | null;
        difference: string | null;
        opened_by_name: string | null;
        cash_income: string;
        cash_expense_total: string;
        transfer_total: string;
      }[]
    >(
      `SELECT
         cs.id,
         cs.date,
         cs.opened_at,
         cs.closed_at,
         cs.status,
         cs.initial_balance,
         cs.cash_counted,
         cs.difference,
         COALESCE(u.full_name, u.username, 'Desconocido')                    AS opened_by_name,
         COALESCE(SUM(t.amount_cash), 0)                                     AS cash_income,
         COALESCE((SELECT SUM(e.amount) FROM expenses e
                   WHERE e.cash_session_id = cs.id AND e.deleted_at IS NULL), 0) AS cash_expense_total,
         COALESCE(SUM(t.amount_transfer), 0)                                 AS transfer_total
       FROM cash_sessions cs
       LEFT JOIN users u        ON u.id  = cs.opened_by_user_id
       LEFT JOIN transactions t ON t.cash_session_id = cs.id
       WHERE cs.status = 'closed'
         AND NOT EXISTS (
           SELECT 1 FROM daily_closures dc WHERE dc.date = cs.date
         )
       GROUP BY cs.id, u.full_name, u.username
       ORDER BY cs.date ASC, cs.opened_at ASC`,
      [],
    );

    if (!allOrphanedRows.length) {
      throw new NotFoundException(
        'No hay turnos cerrados pendientes de Cierre de Jornada. Cerrá al menos un turno antes de continuar.',
      );
    }

    const uniqueDates = [...new Set(allOrphanedRows.map((r) => r.date))].sort();
    if (uniqueDates.length > 1) {
      this.logger.warn(
        `closeDay: se detectaron sesiones huérfanas de ${uniqueDates.length} fechas distintas ` +
          `(${uniqueDates.join(', ')}). Se cerrará únicamente la más antigua: ${uniqueDates[0]}.`,
      );
    }

    // Procesar solo la fecha contable más antigua pendiente.
    const commercialDateStr = uniqueDates[0];
    const rows = allOrphanedRows.filter((r) => r.date === commercialDateStr);

    // Guardia contra race condition / doble clic.
    const existingClosure = await this.dailyClosureRepo.findOne({
      where: { date: commercialDateStr },
    });
    if (existingClosure) {
      throw new BadRequestException(
        `La jornada comercial del ${commercialDateStr} ya fue cerrada. No se puede volver a cerrar.`,
      );
    }

    const sessions = rows.map((row) => {
      const ib = Number(row.initial_balance) || 0;
      const cashIncome = parseFloat(row.cash_income);
      const cashExpenses = parseFloat(row.cash_expense_total);
      const cashExpected = Math.max(0, cashIncome - cashExpenses);
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
        difference: row.cash_counted != null ? parseFloat(row.cash_counted) - cashExpected : null,
      };
    });

    const totalExpected = sessions.reduce((s, sess) => s + sess.dayTotal, 0);
    const allClosed = sessions.every((s) => s.cashCounted !== null);
    const totalCounted = allClosed
      ? sessions.reduce((s, sess) => s + (sess.cashCounted ?? 0), 0)
      : null;

    const closureRecord = this.dailyClosureRepo.create({ date: commercialDateStr });
    await this.dailyClosureRepo.save(closureRecord);
    this.logger.log(`Cierre de Jornada registrado para la fecha comercial: ${commercialDateStr}`);

    return { date: commercialDateStr, totalExpected, totalCounted, sessions };
  }

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

    const sessionDate = openSession.date;

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
      this.dataSource.query<{ total: string; cash: string; transfer: string }[]>(
        `SELECT
             COALESCE(SUM(amount_cash + amount_transfer), 0) AS total,
             COALESCE(SUM(amount_cash),                  0) AS cash,
             COALESCE(SUM(amount_transfer),              0) AS transfer
           FROM transactions
           WHERE cash_session_id = $1`,
        [openSession.id],
      ),
      this.dataSource.query<{ completed: string }[]>(
        `SELECT COUNT(*) AS completed
           FROM bookings
           WHERE date = $1 AND status = 'completed'`,
        [sessionDate],
      ),
      this.dataSource.query<{ live: string }[]>(
        `SELECT COUNT(*) AS live
           FROM bookings
           WHERE date = $1 AND status = 'playing'`,
        [sessionDate],
      ),
      this.dataSource.query<{ canceled: string }[]>(
        `SELECT COUNT(*) AS canceled
           FROM bookings
           WHERE date = $1 AND status = 'cancelled'`,
        [sessionDate],
      ),
      this.dataSource.query<{ court_count: string }[]>(
        `SELECT COUNT(*) AS court_count FROM courts WHERE is_active = true`,
      ),
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
    const totalSlots = courtCount * 14;
    const occupationRate = totalSlots > 0 ? Math.round((completedBookings / totalSlots) * 100) : 0;

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
        initial_balance: string;
        cash_counted: string | null;
        cash_income: string;
        cash_expense_total: string;
        transfer_total: string;
        opened_by_name: string | null;
      }[]
    >(
      `SELECT
         cs.id,
         cs.opened_at,
         cs.closed_at,
         cs.status,
         cs.initial_balance,
         cs.cash_counted,
         COALESCE(u.full_name, u.username, 'Desconocido')    AS opened_by_name,
         COALESCE(SUM(t.amount_cash),     0)                 AS cash_income,
         COALESCE(SUM(t.amount_transfer), 0)                 AS transfer_total,
         COALESCE((
           SELECT SUM(e.amount)
           FROM expenses e
           WHERE e.cash_session_id = cs.id
             AND e.deleted_at IS NULL
         ), 0)                                               AS cash_expense_total
       FROM cash_sessions cs
       LEFT JOIN users u        ON u.id  = cs.opened_by_user_id
       LEFT JOIN transactions t ON t.cash_session_id = cs.id
       WHERE cs.date = $1
       GROUP BY cs.id, u.full_name, u.username
       ORDER BY cs.opened_at ASC`,
      [date],
    );

    const sessions = rows.map((row) => {
      const ib = Number(row.initial_balance) || 0;
      const cashIncome = parseFloat(row.cash_income ?? '0');
      const cashExpenses = parseFloat(row.cash_expense_total ?? '0');
      const cashExpected = Math.max(0, cashIncome - cashExpenses);
      const transferTotal = parseFloat(row.transfer_total ?? '0');
      const cashCounted = row.cash_counted != null ? parseFloat(row.cash_counted) : null;
      const difference = cashCounted !== null ? cashCounted - cashExpected : null;
      return {
        sessionId: row.id,
        openedByName: row.opened_by_name ?? 'Desconocido',
        openedAt: row.opened_at,
        closedAt: row.closed_at,
        status: row.status as CashSessionStatus,
        cashExpected,
        transferTotal,
        dayTotal: cashExpected + transferTotal,
        cashCounted,
        difference,
      };
    });

    const totalExpected = sessions.reduce((s, sess) => s + sess.dayTotal, 0);
    const allClosed = sessions.every((s) => s.cashCounted !== null);
    const totalCounted = allClosed
      ? sessions.reduce((s, sess) => s + (sess.cashCounted ?? 0), 0)
      : null;

    return { date, totalExpected, totalCounted, sessions };
  }

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
    const cashExpected = await this.dataSource.query<
      {
        cash_income: string;
        transfer: string;
        cash_expenses: string;
      }[]
    >(
      `SELECT
         (SELECT COALESCE(SUM(amount_cash),     0) FROM transactions WHERE cash_session_id = $1) AS cash_income,
         (SELECT COALESCE(SUM(amount_transfer), 0) FROM transactions WHERE cash_session_id = $1) AS transfer,
         (SELECT COALESCE(SUM(amount),          0) FROM expenses    WHERE cash_session_id = $1 AND deleted_at IS NULL) AS cash_expenses`,
      [sessionId],
    );
    const cashIncome = parseFloat(cashExpected[0]?.cash_income ?? '0');
    const cashExpenses = parseFloat(cashExpected[0]?.cash_expenses ?? '0');
    const transferencia = parseFloat(cashExpected[0]?.transfer ?? '0');
    const initialBal = parseFloat(s.initial_balance ?? '0');
    const efectivoEsperado = Math.max(0, initialBal + cashIncome - cashExpenses);
    const totalSistema = efectivoEsperado + transferencia;
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
         t.type::text AS type,
         t.concept,
         t.amount_cash,
         t.amount_transfer,
         s.customer_name,
         COALESCE(u.full_name, u.username) AS created_by_name
       FROM transactions t
       LEFT JOIN users u ON u.id = t.created_by_user_id
       LEFT JOIN sales s ON s.id = t.reference_id AND t.type = 'sale'
       WHERE t.cash_session_id = $1

       UNION ALL

       SELECT
         e.created_at,
         'expense' AS type,
         e.description AS concept,
         e.amount AS amount_cash,
         0 AS amount_transfer,
         NULL AS customer_name,
         NULL AS created_by_name
       FROM expenses e
       WHERE e.cash_session_id = $1 AND e.deleted_at IS NULL

       ORDER BY created_at ASC`,
      [sessionId],
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = 'PadelSys';
    wb.created = new Date();

    const wsR = wb.addWorksheet('Resumen');
    wsR.columns = [
      { key: 'label', width: 34 },
      { key: 'value', width: 30 },
    ];

    const fmtDate = (d: Date | null) =>
      d
        ? new Date(d).toLocaleString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—';
    const fmtNum = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2 });

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
    addRow('Fondo inicial (cambio)', `$ ${fmtNum(initialBal)}`);
    addRow('+ Ingresos en Efectivo', `$ ${fmtNum(cashIncome)}`);
    addRow('- Egresos en Efectivo (gastos)', `$ ${fmtNum(cashExpenses)}`);
    addRow('= Efectivo esperado (sistema)', `$ ${fmtNum(efectivoEsperado)}`);
    addRow('Transferencias recibidas', `$ ${fmtNum(transferencia)}`);
    addRow('Total sistema', `$ ${fmtNum(totalSistema)}`);
    wsR.addRow([]);

    addSection('ARQUEO FÍSICO');
    addRow(
      'Efectivo contado',
      cashCounted != null ? `$ ${fmtNum(cashCounted)}` : '(turno aún abierto)',
    );
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
        hora: new Date(tx.created_at).toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
        tipo: tx.type === 'booking' ? 'Turno' : tx.type === 'expense' ? 'Egreso' : 'Venta',
        desc: tx.concept,
        cliente: tx.customer_name ?? '—',
        cajero: tx.created_by_name ?? '—',
        cash,
        transfer,
        total: cash + transfer,
      });

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

    if (transactions.length > 0) {
      wsT.addRow([]);
      const totalRow = wsT.addRow({
        hora: '',
        tipo: '',
        desc: 'TOTAL',
        cliente: '',
        cajero: '',
        cash: efectivoEsperado,
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
        cash_income: string;
        cash_expense_total: string;
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
         COALESCE(SUM(CASE WHEN t.type != 'expense' THEN t.amount_cash     ELSE 0 END), 0) AS cash_income,
         COALESCE(SUM(CASE WHEN t.type  = 'expense' THEN t.amount_cash     ELSE 0 END), 0) AS cash_expense_total,
         COALESCE(SUM(CASE WHEN t.type != 'expense' THEN t.amount_transfer ELSE 0 END), 0) AS transfer_total
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
      d
        ? new Date(d).toLocaleString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—';
    const fmtNum = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2 });

    const totalCashIncome = rows.reduce((s, r) => s + parseFloat(r.cash_income), 0);
    const totalCashExpenses = rows.reduce((s, r) => s + parseFloat(r.cash_expense_total), 0);
    const totalInitialBal = rows.reduce((s, r) => s + parseFloat(r.initial_balance ?? '0'), 0);
    const totalEfectivo = rows.reduce(
      (s, r) =>
        s +
        Math.max(
          0,
          parseFloat(r.initial_balance ?? '0') +
            parseFloat(r.cash_income) -
            parseFloat(r.cash_expense_total),
        ),
      0,
    );
    const totalTransfer = rows.reduce((s, r) => s + parseFloat(r.transfer_total), 0);
    const totalDia = totalEfectivo + totalTransfer;
    const allClosed = rows.every((r) => r.status === 'closed');
    const totalContado = allClosed
      ? rows.reduce((s, r) => s + (r.cash_counted != null ? parseFloat(r.cash_counted) : 0), 0)
      : null;

    const [yr, mo, dy] = date.split('-').map(Number);
    const dateLabel = new Date(yr, mo - 1, dy).toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

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
    addRow('Fondo inicial total (cambio)', `$ ${fmtNum(totalInitialBal)}`);
    addRow('+ Ingresos en Efectivo', `$ ${fmtNum(totalCashIncome)}`);
    addRow('- Egresos en Efectivo (gastos)', `$ ${fmtNum(totalCashExpenses)}`);
    addRow('= Efectivo esperado (sistema)', `$ ${fmtNum(totalEfectivo)}`);
    addRow('Transferencias totales', `$ ${fmtNum(totalTransfer)}`);
    addRow('Recaudación total del día', `$ ${fmtNum(totalDia)}`);
    addRow(
      'Arqueo físico total',
      totalContado != null ? `$ ${fmtNum(totalContado)}` : '(hay turnos aún abiertos)',
    );
    wsR.addRow([]);

    addSection('DETALLE POR TURNO');
    rows.forEach((r, i) => {
      const ib = parseFloat(r.initial_balance ?? '0');
      const ci = parseFloat(r.cash_income);
      const ce = parseFloat(r.cash_expense_total);
      const ef = Math.max(0, ci - ce);
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
      addRow('Fondo inicial (cambio)', `$ ${fmtNum(ib)}`);
      addRow('+ Ingresos en Efectivo', `$ ${fmtNum(ci)}`);
      addRow('- Egresos en Efectivo (gastos)', `$ ${fmtNum(ce)}`);
      addRow('= Efectivo esperado (sistema)', `$ ${fmtNum(ef)}`);
      addRow('Transferencias', `$ ${fmtNum(tr)}`);
      addRow('Total turno', `$ ${fmtNum(ef + tr)}`);
      if (r.cash_counted != null) {
        addRow('Efectivo contado', `$ ${fmtNum(parseFloat(r.cash_counted))}`);
        const diff = parseFloat(r.difference ?? '0');
        addRow(
          'Diferencia',
          diff === 0
            ? 'Cuadra ✓'
            : diff > 0
              ? `+$ ${fmtNum(diff)}`
              : `−$ ${fmtNum(Math.abs(diff))}`,
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

    const wsS = wb.addWorksheet('Desglose por Turno');
    wsS.columns = [
      { header: 'Turno #', key: 'num', width: 9 },
      { header: 'Abierto por', key: 'abiertoPor', width: 26 },
      { header: 'Cerrado por', key: 'cerradoPor', width: 26 },
      { header: 'Apertura', key: 'apertura', width: 20 },
      { header: 'Cierre', key: 'cierre', width: 20 },
      { header: 'Estado', key: 'estado', width: 12 },
      { header: 'Ingresos Ef. ($)', key: 'cashIn', width: 18 },
      { header: 'Egresos Ef. ($)', key: 'cashOut', width: 17 },
      { header: 'Ef. Esperado ($)', key: 'cash', width: 18 },
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
      const ib = parseFloat(r.initial_balance ?? '0');
      const ci = parseFloat(r.cash_income);
      const ce = parseFloat(r.cash_expense_total);
      const ef = Math.max(0, ci - ce);
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
        cashIn: ci,
        cashOut: ce,
        cash: ef,
        transfer: tr,
        total: ef + tr,
        contado: contado ?? '—',
        diff: diff != null ? diff : '—',
      });

      ['cashIn', 'cashOut', 'cash', 'transfer', 'total'].forEach((key) => {
        const cell = row.getCell(key);
        cell.numFmt = '"$"#,##0.00';
        cell.alignment = { horizontal: 'right' };
      });
      row.getCell('cashOut').font = { color: { argb: 'FFCC0000' } };

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

    wsS.addRow([]);
    const totRow = wsS.addRow({
      num: '',
      abiertoPor: 'TOTAL',
      cerradoPor: '',
      apertura: '',
      cierre: '',
      estado: '',
      cashIn: totalCashIncome,
      cashOut: totalCashExpenses,
      cash: totalEfectivo,
      transfer: totalTransfer,
      total: totalDia,
      contado: totalContado ?? '—',
      diff: '',
    });
    totRow.font = { bold: true };
    ['cashIn', 'cashOut', 'cash', 'transfer', 'total'].forEach((key) => {
      const cell = totRow.getCell(key);
      cell.numFmt = '"$"#,##0.00';
      cell.alignment = { horizontal: 'right' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFe6f4ec' } };
    });
    if (totalContado != null) {
      totRow.getCell('contado').numFmt = '"$"#,##0.00';
      totRow.getCell('contado').alignment = { horizontal: 'right' };
      totRow.getCell('contado').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFe6f4ec' },
      };
    }

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer as ArrayBuffer);
  }

  /**
   * Retorna el inicio del día comercial activo como timestamp UTC.
   * El día comercial comienza a las 02:00 AM hora Argentina (UTC-3 → 05:00 UTC).
   * Si la hora actual es anterior a las 02:00 AM Argentina, el día comercial comenzó
   * AYER a las 02:00 AM.
   *
   * Se utiliza para filtrar sesiones por ventana temporal sin depender del campo `date`
   * de la sesión, resolviendo así el caso de turnos trasnoche donde session.date es del
   * día anterior al cierre físico.
   */
  private getCommercialDayStart(): Date {
    const TZ = 'America/Argentina/Buenos_Aires';
    const CUTOFF_HOUR = 3;
    const ARG_UTC_OFFSET = 3;

    const now = new Date();
    const hourParts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const currentHour = parseInt(hourParts.find((p) => p.type === 'hour')?.value ?? '12', 10);

    const argDateStr = now.toLocaleDateString('en-CA', { timeZone: TZ });
    const [year, month, day] = argDateStr.split('-').map(Number);

    if (currentHour < CUTOFF_HOUR) {
      return new Date(Date.UTC(year, month - 1, day - 1, CUTOFF_HOUR + ARG_UTC_OFFSET, 0, 0));
    }
    return new Date(Date.UTC(year, month - 1, day, CUTOFF_HOUR + ARG_UTC_OFFSET, 0, 0));
  }

  /**
   * Retorna la fecha comercial vigente para la fecha/hora dada (default: ahora),
   * en zona horaria Argentina (YYYY-MM-DD).
   *
   * Regla de negocio: el establecimiento cierra entre la 01:00 AM y las 02:00 AM.
   * Por eso, horas entre las 00:00 y las 02:59 AM pertenecen al día comercial ANTERIOR.
   * Ej: Sábado 01:30 AM → jornada del Viernes. Sábado 03:00 AM → jornada del Sábado.
   *
   * REGLA CRÍTICA: Esta función se usa para asignar la fecha a una nueva sesión y para
   * comparar fechas de cierre. Una sesión ya OPEN conserva su `date` original de forma inmutable.
   */
  getBusinessDate(date: Date = new Date()): string {
    const CUTOFF_HOUR = 3;
    const TZ = 'America/Argentina/Tucuman';

    // Get the current date string in Argentina timezone first (YYYY-MM-DD).
    // Using toLocaleDateString with explicit TZ is safe regardless of server timezone.
    const argDateStr = date.toLocaleDateString('en-CA', { timeZone: TZ });

    const currentHour = parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        hour: 'numeric',
        hour12: false,
      })
        .formatToParts(date)
        .find((p) => p.type === 'hour')?.value ?? '12',
      10,
    );

    if (currentHour < CUTOFF_HOUR) {
      // Compute the previous calendar day purely from the Argentina date string.
      // We use noon UTC as the intermediate timestamp so the resulting Date is never
      // ambiguous near a midnight boundary regardless of the server's local timezone.
      // toLocaleDateString with an explicit TZ is then used — never toISOString() —
      // to stay consistent with how argDateStr itself was obtained.
      const [y, m, d] = argDateStr.split('-').map(Number);
      const prev = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0));
      return prev.toLocaleDateString('en-CA', { timeZone: TZ });
    }

    return argDateStr;
  }
}
