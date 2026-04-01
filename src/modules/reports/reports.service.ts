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
           DATE_TRUNC($1, (created_at AT TIME ZONE $2))::date::text AS period,
           COALESCE(SUM(CASE WHEN type = 'booking' THEN amount_cash + amount_transfer ELSE 0 END), 0) AS bookings,
           COALESCE(SUM(CASE WHEN type = 'sale'    THEN amount_cash + amount_transfer ELSE 0 END), 0) AS sales
         FROM transactions
         WHERE (created_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
         GROUP BY 1
       ),
       exp AS (
         SELECT
           DATE_TRUNC($1, date)::date::text AS period,
           COALESCE(SUM(amount), 0)         AS expenses
         FROM expenses
         WHERE date BETWEEN $3::date AND $4::date
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
      [trunc, this.TZ, from, to],
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
         COALESCE(SUM(amount_cash), 0)     AS cash_total,
         COALESCE(SUM(amount_transfer), 0) AS transfer_total
       FROM transactions
       WHERE (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`,
      [this.TZ, from, to],
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
           s.created_at
         FROM sale_items si
         JOIN products p ON p.id = si.product_id
         JOIN sales    s ON s.id = si.sale_id

         UNION ALL

         SELECT
           bi.product_id,
           p.name AS product_name,
           bi.quantity,
           bi.unit_price * bi.quantity AS line_total,
           b.created_at
         FROM booking_items bi
         JOIN products p  ON p.id = bi.product_id
         JOIN bookings b  ON b.id = bi.booking_id
         WHERE b.status != 'cancelled'
       )
       SELECT
         product_id,
         product_name,
         SUM(quantity)   AS qty,
         SUM(line_total) AS revenue
       FROM unified
       WHERE (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
       GROUP BY product_id, product_name
       ORDER BY qty DESC
       LIMIT 20`,
      [this.TZ, from, to],
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
      }[]
    >(
      `SELECT
         (t.created_at AT TIME ZONE $1)::date::text                     AS date,
         TO_CHAR(t.created_at AT TIME ZONE $1, 'HH24:MI')               AS time,
         t.type,
         t.concept,
         t.amount_cash                                                   AS cash,
         t.amount_transfer                                               AS transfer,
         (t.amount_cash + t.amount_transfer)                            AS total,
         u.full_name                                                     AS created_by
       FROM transactions t
       JOIN users u ON u.id = t.created_by_user_id
       WHERE (t.created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
       ORDER BY t.created_at ASC`,
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
  async getRevenueTrend(days = 7): Promise<
    { date: string; cash: number; transfer: number; total: number }[]
  > {
    const rows = await this.dataSource.query<
      { date: string; cash: string; transfer: string }[]
    >(
      `SELECT
         (created_at AT TIME ZONE $1)::date::text                  AS date,
         COALESCE(SUM(amount_cash),                           0)   AS cash,
         COALESCE(SUM(amount_transfer),                       0)   AS transfer
       FROM transactions
       WHERE (created_at AT TIME ZONE $1)::date
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
    }[];
    totalAmount: number;
    byCategory: { category: string; total: number }[];
    byPaymentMethod: { method: string; total: number }[];
  }> {
    const { from, to } = this.resolveDateRange(dto);

    const items = await this.dataSource.query<{
      id: string;
      date: string;
      description: string;
      category: string;
      payment_method: string;
      amount: string;
    }[]>(
      `SELECT
         id,
         date::text,
         description,
         category,
         payment_method,
         amount
       FROM expenses
       WHERE date BETWEEN $1::date AND $2::date
         AND deleted_at IS NULL
       ORDER BY date DESC, created_at DESC`,
      [from, to],
    );

    const byCategory = await this.dataSource.query<{
      category: string;
      total: string;
    }[]>(
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

    const byPaymentMethod = await this.dataSource.query<{
      payment_method: string;
      total: string;
    }[]>(
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
         COALESCE(SUM(amount_cash + amount_transfer), 0)                               AS total_revenue,
         COALESCE(SUM(CASE WHEN type = 'booking' THEN amount_cash + amount_transfer ELSE 0 END), 0) AS bookings_revenue,
         COALESCE(SUM(CASE WHEN type = 'sale'    THEN amount_cash + amount_transfer ELSE 0 END), 0) AS sales_revenue,
         COALESCE(SUM(amount_cash), 0)                                                 AS cash_total,
         COALESCE(SUM(amount_transfer), 0)                                             AS transfer_total,
         COUNT(*)                                                                       AS tx_count,
         (SELECT COALESCE(SUM(amount), 0)
          FROM expenses
          WHERE date BETWEEN $2::date AND $3::date
            AND deleted_at IS NULL)                                                     AS total_expenses
       FROM transactions
       WHERE (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`,
      [this.TZ, from, to],
    );

    const r = rows[0];
    const totalRevenue  = parseFloat(r.total_revenue);
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

  /** Retorna los productos con stock igual o inferior al umbral mínimo. */
  async getLowStock(): Promise<{
    id: string;
    name: string;
    stock: number;
    minStock: number;
  }[]> {
    const rows = await this.dataSource.query<{
      id: string;
      name: string;
      stock: string;
      min_stock: string;
    }[]>(
      `SELECT id, name, stock, min_stock
       FROM products
       WHERE stock <= min_stock
         AND is_active = true
       ORDER BY (stock::numeric / NULLIF(min_stock, 0)) ASC NULLS LAST, name ASC`,
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      stock: parseInt(r.stock, 10),
      minStock: parseInt(r.min_stock, 10),
    }));
  }
}
