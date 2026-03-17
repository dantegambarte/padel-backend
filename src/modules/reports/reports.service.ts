import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ReportQueryDto } from './dto/report-query.dto';

// ─────────────────────────────────────────────────────────────────────────────
//  NOTAS DE DISEÑO — Reportes con raw SQL sobre la tabla transactions
// ─────────────────────────────────────────────────────────────────────────────
//
//  Por qué raw SQL y no QueryBuilder:
//    1. Los reportes usan DATE_TRUNC, CASE WHEN, COALESCE y GROUP BY complejos
//       que TypeORM QueryBuilder soporta con sintaxis verbose y propensa a errores.
//    2. Las queries de reportes raramente cambian; el overhead de mantenimiento
//       del QB no compensa su type-safety cuando la query ya es fija.
//    3. Se parametrizan todos los valores (:1, :2...) → no hay SQL injection.
//
//  Zona horaria:
//    Todas las queries usan AT TIME ZONE 'America/Argentina/Buenos_Aires'
//    para que los totales del día reflejen la hora local del negocio,
//    no UTC (que difiere 3 horas).
//
//  Tabla de origen:
//    - transactions: movimientos de caja (bookings + sales)
//    - sale_items: para el ranking de productos (por cantidad vendida)
//    - booking_items: también para el ranking
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private readonly TZ = `America/Argentina/Buenos_Aires`;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  //  HELPERS
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Resuelve el rango de fechas efectivo para la query.
   *
   * Prioridad:
   *   1. `dto.date`     → filtra exactamente ese día (from = to = date).
   *                        Si no viene, aplica la lógica de período.
   *   2. `dto.dateFrom` / `dto.dateTo` → rango explícito del frontend.
   *   3. Sin ningún parámetro → hoy (comportamiento por defecto para día exacto).
   *
   * Nota: las queries SQL usan BETWEEN sobre la fecha truncada al día local
   * (AT TIME ZONE TZ)::date, por lo que pasar el mismo valor en from y to
   * captura correctamente todo el rango 00:00:00–23:59:59.999 del día.
   */
  private resolveDateRange(dto: ReportQueryDto): { from: string; to: string } {
    // Filtro de día exacto — tiene máxima precedencia
    if (dto.date) {
      return { from: dto.date, to: dto.date };
    }

    const now = new Date();
    // toLocaleDateString con locale neutro + timeZone Argentina evita el desfase UTC
    const localStr = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: this.TZ }); // en-CA → YYYY-MM-DD

    const today = localStr(now);
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const from = dto.dateFrom ?? localStr(firstOfMonth);
    const to = dto.dateTo ?? today;

    return { from, to };
  }

  /**
   * Mapea el parámetro groupBy al truncador de PostgreSQL correspondiente.
   *   day   → DATE_TRUNC('day',   ...)
   *   week  → DATE_TRUNC('week',  ...)
   *   month → DATE_TRUNC('month', ...)
   */
  private pgTrunc(groupBy: 'day' | 'week' | 'month' = 'day'): string {
    const map = { day: 'day', week: 'week', month: 'month' } as const;
    return map[groupBy];
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  GET /reports/revenue
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Ingresos agrupados por período, desglosados por tipo de origen:
   *   - bookings  → alquiler de canchas
   *   - sales     → ventas del POS
   *
   * Ejemplo de respuesta:
   * [
   *   { period: '2025-03-01', bookings: 45000, sales: 12000, total: 57000 },
   *   { period: '2025-03-02', bookings: 30000, sales: 8500,  total: 38500 },
   * ]
   */
  async getRevenue(dto: ReportQueryDto): Promise<
    {
      period: string;
      bookings: number;
      sales: number;
      total: number;
    }[]
  > {
    const { from, to } = this.resolveDateRange(dto);
    const trunc = this.pgTrunc(dto.groupBy);

    const rows = await this.dataSource.query<
      {
        period: string;
        bookings: string;
        sales: string;
      }[]
    >(
      `SELECT
         DATE_TRUNC($1, (created_at AT TIME ZONE $2))::date::text AS period,
         COALESCE(SUM(CASE WHEN type = 'booking' THEN amount_cash + amount_transfer ELSE 0 END), 0) AS bookings,
         COALESCE(SUM(CASE WHEN type = 'sale'    THEN amount_cash + amount_transfer ELSE 0 END), 0) AS sales
       FROM transactions
       WHERE (created_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
       GROUP BY 1
       ORDER BY 1`,
      [trunc, this.TZ, from, to],
    );

    return rows.map((r) => ({
      period: r.period,
      bookings: parseFloat(r.bookings),
      sales: parseFloat(r.sales),
      total: parseFloat(r.bookings) + parseFloat(r.sales),
    }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  GET /reports/payment-methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Distribución de ingresos por método de pago en el período.
   *
   * Ejemplo de respuesta:
   * {
   *   cash:       { total: 78500, percentage: 62.3 },
   *   transfer:   { total: 47500, percentage: 37.7 },
   *   grandTotal: 126000
   * }
   */
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

  // ───────────────────────────────────────────────────────────────────────────
  //  GET /reports/products-ranking
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Ranking de productos más vendidos (por cantidad de unidades).
   * Une sale_items y booking_items en un UNION ALL para capturar ventas
   * del POS y consumos registrados en turnos.
   *
   * Ejemplo de respuesta:
   * [
   *   { rank: 1, productId: '...', name: 'Pelota Babolat', qty: 48, revenue: 19200 },
   *   { rank: 2, productId: '...', name: 'Gatorade 500ml', qty: 35, revenue: 8750  },
   * ]
   */
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
         -- Ventas del POS
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

         -- Items consumidos en turnos
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

  // ───────────────────────────────────────────────────────────────────────────
  //  GET /reports/transactions/export
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Historial plano de transacciones listo para exportar a CSV en el frontend.
   * Cada fila corresponde a un movimiento de caja (booking o venta POS).
   *
   * El frontend puede recibir este JSON, iterar las filas y construir el CSV
   * con PapaParse o similar sin dependencias adicionales en el backend.
   *
   * Ejemplo de respuesta:
   * [
   *   {
   *     date: '2025-03-15',
   *     time: '14:32',
   *     type: 'booking',
   *     concept: 'Turno Cancha 1 - 14hs (Juan Pérez)',
   *     cash: 15000,
   *     transfer: 0,
   *     total: 15000,
   *     createdBy: 'empleado'
   *   },
   *   ...
   * ]
   */
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
         u.username                                                      AS created_by
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

  // ───────────────────────────────────────────────────────────────────────────
  //  GET /reports/summary — Dashboard cards
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Resumen ejecutivo del período: totales agregados para las cards del dashboard.
   *
   * Retorna en una sola query todos los números que el frontend necesita
   * para pintar las cards superiores del módulo de reportes.
   */
  async getSummary(dto: ReportQueryDto): Promise<{
    totalRevenue: number;
    bookingsRevenue: number;
    salesRevenue: number;
    cashTotal: number;
    transferTotal: number;
    transactionCount: number;
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
      }[]
    >(
      `SELECT
         COALESCE(SUM(amount_cash + amount_transfer), 0)                               AS total_revenue,
         COALESCE(SUM(CASE WHEN type = 'booking' THEN amount_cash + amount_transfer ELSE 0 END), 0) AS bookings_revenue,
         COALESCE(SUM(CASE WHEN type = 'sale'    THEN amount_cash + amount_transfer ELSE 0 END), 0) AS sales_revenue,
         COALESCE(SUM(amount_cash), 0)                                                 AS cash_total,
         COALESCE(SUM(amount_transfer), 0)                                             AS transfer_total,
         COUNT(*)                                                                       AS tx_count
       FROM transactions
       WHERE (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`,
      [this.TZ, from, to],
    );

    const r = rows[0];
    return {
      totalRevenue: parseFloat(r.total_revenue),
      bookingsRevenue: parseFloat(r.bookings_revenue),
      salesRevenue: parseFloat(r.sales_revenue),
      cashTotal: parseFloat(r.cash_total),
      transferTotal: parseFloat(r.transfer_total),
      transactionCount: parseInt(r.tx_count, 10),
    };
  }
}
