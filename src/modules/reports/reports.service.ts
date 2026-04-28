import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ReportQueryDto } from './dto/report-query.dto';
import { CashRegisterService } from '../cash-register/cash-register.service';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private readonly TZ = `America/Argentina/Buenos_Aires`;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly cashRegisterService: CashRegisterService,
  ) {}

  /**
   * Resuelve el rango de fechas efectivo.
   * Prioridad: dto.date > dto.dateFrom/dateTo > mes actual.
   */
  private resolveDateRange(dto: ReportQueryDto): { from: string; to: string } {
    if (dto.date) {
      return { from: dto.date, to: dto.date };
    }

    const now = new Date();
    const localStr = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: this.TZ });

    const today = localStr(now);
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const from = dto.dateFrom ?? localStr(firstOfMonth);
    const to = dto.dateTo ?? today;

    return { from, to };
  }

  /** Mapea el parámetro groupBy al truncador DATE_TRUNC de PostgreSQL. */
  private pgTrunc(groupBy: 'day' | 'week' | 'month' = 'day'): string {
    const map = { day: 'day', week: 'week', month: 'month' } as const;
    return map[groupBy];
  }

  /** Retorna ingresos agrupados por período, desglosados en turnos y ventas POS, con egresos. */
  async getRevenue(dto: ReportQueryDto): Promise<
    {
      period: string;
      bookings: number;
      sales: number;
      total: number;
      expenses: number;
    }[]
  > {
    const { from, to } = this.resolveDateRange(dto);
    const trunc = this.pgTrunc(dto.groupBy);

    const rows = await this.dataSource.query<
      {
        period: string;
        bookings: string;
        sales: string;
        expenses: string;
      }[]
    >(
      `WITH income AS (
         SELECT
           DATE_TRUNC($1, cs.date)::date::text AS period,
           COALESCE(SUM(CASE WHEN t.type = 'booking' THEN t.amount_cash + t.amount_transfer ELSE 0 END), 0) AS bookings,
           COALESCE(SUM(CASE WHEN t.type = 'sale'    THEN t.amount_cash + t.amount_transfer ELSE 0 END), 0) AS sales
         FROM transactions t
         JOIN cash_sessions cs ON cs.id = t.cash_session_id
         WHERE cs.date BETWEEN $2::date AND $3::date
         GROUP BY 1
       ),
       exp AS (
         SELECT
           DATE_TRUNC($1, date)::date::text AS period,
           COALESCE(SUM(amount), 0)         AS expenses
         FROM expenses
         WHERE date BETWEEN $2::date AND $3::date
           AND deleted_at IS NULL
         GROUP BY 1
       )
       SELECT
         COALESCE(i.period, e.period) AS period,
         COALESCE(i.bookings,  0)     AS bookings,
         COALESCE(i.sales,     0)     AS sales,
         COALESCE(e.expenses,  0)     AS expenses
       FROM income i
       FULL OUTER JOIN exp e ON i.period = e.period
       ORDER BY 1`,
      [trunc, from, to],
    );

    return rows.map((r) => ({
      period: r.period,
      bookings: parseFloat(r.bookings),
      sales: parseFloat(r.sales),
      total: parseFloat(r.bookings) + parseFloat(r.sales),
      expenses: parseFloat(r.expenses),
    }));
  }

  /** Retorna la distribución de ingresos por método de pago con porcentajes. */
  async getPaymentMethods(dto: ReportQueryDto): Promise<{
    cash: { total: number; percentage: number };
    transfer: { total: number; percentage: number };
    grandTotal: number;
  }> {
    const { from, to } = this.resolveDateRange(dto);

    const rows = await this.dataSource.query<
      {
        cash_total: string;
        transfer_total: string;
      }[]
    >(
      `SELECT
         COALESCE(SUM(t.amount_cash), 0)     AS cash_total,
         COALESCE(SUM(t.amount_transfer), 0) AS transfer_total
       FROM transactions t
       JOIN cash_sessions cs ON cs.id = t.cash_session_id
       WHERE cs.date BETWEEN $1::date AND $2::date`,
      [from, to],
    );

    const cash = parseFloat(rows[0]?.cash_total ?? '0');
    const transfer = parseFloat(rows[0]?.transfer_total ?? '0');
    const grandTotal = cash + transfer;

    const pct = (val: number) => (grandTotal > 0 ? Math.round((val / grandTotal) * 1000) / 10 : 0);

    return {
      cash: { total: cash, percentage: pct(cash) },
      transfer: { total: transfer, percentage: pct(transfer) },
      grandTotal,
    };
  }

  /** Retorna el top 20 de productos más vendidos unificando ventas POS y consumos de turnos. */
  async getProductsRanking(dto: ReportQueryDto): Promise<
    {
      rank: number;
      productId: string;
      name: string;
      qty: number;
      revenue: number;
    }[]
  > {
    const { from, to } = this.resolveDateRange(dto);

    const rows = await this.dataSource.query<
      {
        product_id: string;
        product_name: string;
        qty: string;
        revenue: string;
      }[]
    >(
      `WITH unified AS (
         SELECT
           si.product_id,
           p.name AS product_name,
           si.quantity,
           si.unit_price * si.quantity AS line_total,
           cs.date AS session_date
         FROM sale_items si
         JOIN products    p  ON p.id = si.product_id
         JOIN sales       s  ON s.id = si.sale_id
         JOIN cash_sessions cs ON cs.id = s.cash_session_id

         UNION ALL

         SELECT
           bi.product_id,
           p.name AS product_name,
           bi.quantity,
           bi.unit_price * bi.quantity AS line_total,
           cs.date AS session_date
         FROM booking_items bi
         JOIN products    p  ON p.id = bi.product_id
         JOIN bookings    b  ON b.id = bi.booking_id
         JOIN transactions t  ON t.reference_id = b.id AND t.type = 'booking'
         JOIN cash_sessions cs ON cs.id = t.cash_session_id
         WHERE b.status != 'cancelled'
       )
       SELECT
         product_id,
         product_name,
         SUM(quantity)   AS qty,
         SUM(line_total) AS revenue
       FROM unified
       WHERE session_date BETWEEN $1::date AND $2::date
       GROUP BY product_id, product_name
       ORDER BY qty DESC
       LIMIT 20`,
      [from, to],
    );

    return rows.map((r, i) => ({
      rank: i + 1,
      productId: r.product_id,
      name: r.product_name,
      qty: parseInt(r.qty, 10),
      revenue: parseFloat(r.revenue),
    }));
  }

  /** Retorna el historial plano de transacciones listo para exportar a CSV. */
  async getTransactionsExport(dto: ReportQueryDto): Promise<
    {
      date: string;
      time: string;
      type: string;
      concept: string;
      cash: number;
      transfer: number;
      total: number;
      createdBy: string;
      referenceId: string | null;
    }[]
  > {
    const { from, to } = this.resolveDateRange(dto);

    const rows = await this.dataSource.query<
      {
        date: string;
        time: string;
        type: string;
        concept: string;
        cash: string;
        transfer: string;
        total: string;
        created_by: string;
        reference_id: string | null;
        raw_created_at: string;
      }[]
    >(
      `SELECT
         cs.date::text                                                         AS date,
         TO_CHAR(MAX(t.created_at) AT TIME ZONE $1, 'HH24:MI')                AS time,
         t.type::text                                                          AS type,
         MAX(t.concept)                                                        AS concept,
         SUM(t.amount_cash)                                                    AS cash,
         SUM(t.amount_transfer)                                                AS transfer,
         SUM(t.amount_cash + t.amount_transfer)                                AS total,
         MAX(u.full_name)                                                      AS created_by,
         COALESCE(t.reference_id::varchar, t.id::varchar)                     AS reference_id,
         MAX(t.created_at)                                                     AS raw_created_at
       FROM transactions t
       JOIN cash_sessions cs ON cs.id = t.cash_session_id
       JOIN users u ON u.id = t.created_by_user_id
       WHERE cs.date BETWEEN $2::date AND $3::date
       GROUP BY cs.date, t.type, COALESCE(t.reference_id::varchar, t.id::varchar)

       UNION ALL

       SELECT
         cs.date::text                                                   AS date,
         TO_CHAR(e.created_at AT TIME ZONE $1, 'HH24:MI')               AS time,
         'expense'                                                       AS type,
         e.description                                                   AS concept,
         e.amount                                                        AS cash,
         0                                                               AS transfer,
         e.amount                                                        AS total,
         NULL                                                            AS created_by,
         NULL                                                            AS reference_id,
         e.created_at                                                    AS raw_created_at
       FROM expenses e
       JOIN cash_sessions cs ON cs.id = e.cash_session_id
       WHERE cs.date BETWEEN $2::date AND $3::date
         AND e.deleted_at IS NULL

       ORDER BY raw_created_at DESC`,
      [this.TZ, from, to],
    );

    return rows.map((r) => ({
      date: r.date,
      time: r.time,
      type: r.type,
      concept: r.concept,
      cash: parseFloat(r.cash),
      transfer: parseFloat(r.transfer),
      total: parseFloat(r.total),
      createdBy: r.created_by,
      referenceId: r.reference_id ?? null,
    }));
  }

  /**
   * KPIs de la jornada activa para el Dashboard Admin.
   * Delega a CashRegisterService para que las métricas reflejen
   * la sesión OPEN actual (no el día calendario), garantizando que
   * el cruce de medianoche no rompa la contabilidad del turno.
   */
  /**
   * KPIs de la sesión de caja activa para el Dashboard Admin.
   * El parámetro `date` se acepta para futura extensión (consulta histórica);
   * actualmente la implementación siempre usa la sesión activa.
   */
  async getKpis(_date?: string): Promise<{
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
    const kpis = await this.cashRegisterService.getActiveSessionKpis();
    return {
      totalRevenue: kpis.totalRevenue,
      cashTotal: kpis.cashTotal,
      transferTotal: kpis.transferTotal,
      completedBookings: kpis.completedBookings,
      liveBookings: kpis.liveBookings,
      canceledBookings: kpis.canceledBookings,
      totalOperations: kpis.totalOperations,
      totalSlots: kpis.totalSlots,
      occupationRate: kpis.occupationRate,
      cantinaItemsSold: kpis.cantinaItemsSold,
      cantinaRevenue: kpis.cantinaRevenue,
      courtsRevenue: kpis.courtsRevenue,
      topProduct: kpis.topProduct,
      averageTicket: kpis.averageTicket,
    };
  }

  /**
   * Ingresos de los últimos N días desglosados en Efectivo y Transferencia.
   * Alimenta el gráfico de barras del Dashboard Admin.
   * @param days - Número de días hacia atrás (default: 7).
   */
  async getRevenueTrend(
    days = 7,
  ): Promise<{ date: string; cash: number; transfer: number; total: number }[]> {
    const rows = await this.dataSource.query<{ date: string; cash: string; transfer: string }[]>(
      `SELECT
         cs.date::text                                              AS date,
         COALESCE(SUM(t.amount_cash),       0)                     AS cash,
         COALESCE(SUM(t.amount_transfer),   0)                     AS transfer
       FROM transactions t
       JOIN cash_sessions cs ON cs.id = t.cash_session_id
       WHERE cs.date
             BETWEEN (CURRENT_DATE AT TIME ZONE $1)::date - ($2 - 1)
             AND     (CURRENT_DATE AT TIME ZONE $1)::date
       GROUP BY 1
       ORDER BY 1`,
      [this.TZ, days],
    );

    return rows.map((r) => ({
      date: r.date,
      cash: parseFloat(r.cash),
      transfer: parseFloat(r.transfer),
      total: parseFloat(r.cash) + parseFloat(r.transfer),
    }));
  }

  /**
   * Retorna el listado de egresos del período con totales por categoría y método.
   * Usa la tabla `expenses` (soft-delete: filtra `deleted_at IS NULL`).
   */
  async getExpenses(dto: ReportQueryDto): Promise<{
    items: {
      id: string;
      date: string;
      description: string;
      category: string;
      paymentMethod: string;
      amount: number;
      createdByUser: { id: string; fullName: string; role: string } | null;
    }[];
    totalAmount: number;
    byCategory: { category: string; total: number }[];
    byPaymentMethod: { method: string; total: number }[];
  }> {
    const { from, to } = this.resolveDateRange(dto);

    const items = await this.dataSource.query<
      {
        id: string;
        date: string;
        description: string;
        category: string;
        payment_method: string;
        amount: string;
        creator_id: string | null;
        creator_full_name: string | null;
        creator_role: string | null;
      }[]
    >(
      `SELECT
         e.id,
         e.date::text,
         e.description,
         e.category,
         e.payment_method,
         e.amount,
         u.id           AS creator_id,
         u.full_name    AS creator_full_name,
         u.role         AS creator_role
       FROM expenses e
       LEFT JOIN users u ON u.id = e.created_by_user_id
       WHERE e.date BETWEEN $1::date AND $2::date
         AND e.deleted_at IS NULL
       ORDER BY e.date DESC, e.created_at DESC`,
      [from, to],
    );

    const byCategory = await this.dataSource.query<
      {
        category: string;
        total: string;
      }[]
    >(
      `SELECT
         category,
         SUM(amount) AS total
       FROM expenses
       WHERE date BETWEEN $1::date AND $2::date
         AND deleted_at IS NULL
       GROUP BY category
       ORDER BY total DESC`,
      [from, to],
    );

    const byPaymentMethod = await this.dataSource.query<
      {
        payment_method: string;
        total: string;
      }[]
    >(
      `SELECT
         payment_method,
         SUM(amount) AS total
       FROM expenses
       WHERE date BETWEEN $1::date AND $2::date
         AND deleted_at IS NULL
       GROUP BY payment_method
       ORDER BY total DESC`,
      [from, to],
    );

    const mapped = items.map((r) => ({
      id: r.id,
      date: r.date,
      description: r.description,
      category: r.category,
      paymentMethod: r.payment_method,
      amount: parseFloat(r.amount),
      createdByUser: r.creator_id
        ? { id: r.creator_id, fullName: r.creator_full_name!, role: r.creator_role! }
        : null,
    }));

    return {
      items: mapped,
      totalAmount: mapped.reduce((s, e) => s + e.amount, 0),
      byCategory: byCategory.map((r) => ({
        category: r.category,
        total: parseFloat(r.total),
      })),
      byPaymentMethod: byPaymentMethod.map((r) => ({
        method: r.payment_method,
        total: parseFloat(r.total),
      })),
    };
  }

  /** Retorna los totales agregados del período para las cards del dashboard. */
  async getSummary(dto: ReportQueryDto): Promise<{
    totalRevenue: number;
    bookingsRevenue: number;
    salesRevenue: number;
    cashTotal: number;
    transferTotal: number;
    transactionCount: number;
    totalExpenses: number;
    netProfit: number;
  }> {
    const { from, to } = this.resolveDateRange(dto);

    const rows = await this.dataSource.query<
      {
        total_revenue: string;
        bookings_revenue: string;
        sales_revenue: string;
        cash_total: string;
        transfer_total: string;
        tx_count: string;
        total_expenses: string;
      }[]
    >(
      `SELECT
         COALESCE(SUM(t.amount_cash + t.amount_transfer), 0)                               AS total_revenue,
         COALESCE(SUM(CASE WHEN t.type = 'booking' THEN t.amount_cash + t.amount_transfer ELSE 0 END), 0) AS bookings_revenue,
         COALESCE(SUM(CASE WHEN t.type = 'sale'    THEN t.amount_cash + t.amount_transfer ELSE 0 END), 0) AS sales_revenue,
         COALESCE(SUM(t.amount_cash), 0)                                                 AS cash_total,
         COALESCE(SUM(t.amount_transfer), 0)                                             AS transfer_total,
         COUNT(*)                                                                         AS tx_count,
         (SELECT COALESCE(SUM(amount), 0)
          FROM expenses
          WHERE date BETWEEN $1::date AND $2::date
            AND deleted_at IS NULL)                                                       AS total_expenses
       FROM transactions t
       JOIN cash_sessions cs ON cs.id = t.cash_session_id
       WHERE cs.date BETWEEN $1::date AND $2::date`,
      [from, to],
    );

    const r = rows[0];
    const totalRevenue = parseFloat(r.total_revenue);
    const totalExpenses = parseFloat(r.total_expenses);
    return {
      totalRevenue,
      bookingsRevenue: parseFloat(r.bookings_revenue),
      salesRevenue: parseFloat(r.sales_revenue),
      cashTotal: parseFloat(r.cash_total),
      transferTotal: parseFloat(r.transfer_total),
      transactionCount: parseInt(r.tx_count, 10),
      totalExpenses,
      netProfit: totalRevenue - totalExpenses,
    };
  }
}
