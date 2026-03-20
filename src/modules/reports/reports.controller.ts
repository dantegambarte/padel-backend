import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { ReportQueryDto } from './dto/report-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('Reportes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * GET /api/v1/reports/today-kpis
   *
   * KPIs del día actual para el Dashboard Admin:
   *   - Ingresos totales de hoy (efectivo + transferencia)
   *   - Turnos completados y tasa de ocupación
   *   - Unidades de productos vendidos
   */
  @Get('today-kpis')
  @ApiOperation({ summary: 'KPIs de hoy para el Dashboard Admin' })
  @ApiResponse({ status: 200, description: 'Métricas del día actual.' })
  getTodayKpis() {
    return this.reportsService.getTodayKpis();
  }

  /**
   * GET /api/v1/reports/last7days
   *
   * Ingresos de los últimos 7 días desglosados en Efectivo y Transferencia.
   * Alimenta el gráfico de barras del Dashboard Admin.
   */
  @Get('last7days')
  @ApiOperation({ summary: 'Ingresos de los últimos 7 días por método de pago' })
  @ApiResponse({ status: 200, description: 'Array de días con cash/transfer/total.' })
  getLast7DaysRevenue() {
    return this.reportsService.getLast7DaysRevenue();
  }

  /**
   * GET /api/v1/reports/summary
   *
   * Cards del dashboard de reportes: totales agregados del período.
   * Diseñado para una sola query → mínima latencia al cargar la vista.
   */
  @Get('summary')
  @ApiOperation({
    summary: 'Resumen ejecutivo del período',
    description:
      'Retorna los totales agregados (ingresos, distribución por tipo y método de pago) ' +
      'para las cards superiores del dashboard de reportes.',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2025-03-15',
    description: 'Día exacto (tiene precedencia sobre dateFrom/dateTo).',
  })
  @ApiQuery({ name: 'dateFrom', required: false, example: '2025-03-01' })
  @ApiQuery({ name: 'dateTo', required: false, example: '2025-03-31' })
  @ApiResponse({ status: 200, description: 'Resumen del período.' })
  getSummary(@Query() query: ReportQueryDto) {
    return this.reportsService.getSummary(query);
  }

  /**
   * GET /api/v1/reports/revenue?dateFrom=&dateTo=&groupBy=day|week|month
   *
   * Serie temporal de ingresos agrupados por granularidad, desglosados en
   * "Alquileres" (bookings) vs "Productos" (ventas POS). Alimenta el gráfico
   * de barras del prototipo.
   */
  @Get('revenue')
  @ApiOperation({
    summary: 'Ingresos por período agrupados por tipo',
    description:
      'Serie temporal de ingresos desglosada en Alquileres (turnos) y Productos (ventas POS). ' +
      'groupBy acepta "day" (default), "week" o "month".',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2025-03-15',
    description: 'Día exacto (tiene precedencia sobre dateFrom/dateTo).',
  })
  @ApiQuery({ name: 'dateFrom', required: false, example: '2025-03-01' })
  @ApiQuery({ name: 'dateTo', required: false, example: '2025-03-31' })
  @ApiQuery({ name: 'groupBy', required: false, example: 'day', enum: ['day', 'week', 'month'] })
  @ApiResponse({ status: 200, description: 'Serie de ingresos por período.' })
  getRevenue(@Query() query: ReportQueryDto) {
    return this.reportsService.getRevenue(query);
  }

  /**
   * GET /api/v1/reports/payment-methods?dateFrom=&dateTo=
   *
   * Distribución de ingresos: Efectivo vs Transferencia.
   * Alimenta el gráfico de torta del prototipo.
   */
  @Get('payment-methods')
  @ApiOperation({
    summary: 'Distribución de ingresos por método de pago',
    description:
      'Retorna totales y porcentajes de Efectivo vs Transferencia para el período solicitado.',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2025-03-15',
    description: 'Día exacto (tiene precedencia sobre dateFrom/dateTo).',
  })
  @ApiQuery({ name: 'dateFrom', required: false, example: '2025-03-01' })
  @ApiQuery({ name: 'dateTo', required: false, example: '2025-03-31' })
  @ApiResponse({ status: 200, description: 'Distribución de métodos de pago.' })
  getPaymentMethods(@Query() query: ReportQueryDto) {
    return this.reportsService.getPaymentMethods(query);
  }

  /**
   * GET /api/v1/reports/products-ranking?dateFrom=&dateTo=
   *
   * Top 20 productos más vendidos por unidades, sumando ventas POS y
   * consumos registrados en turnos. Alimenta la tabla de ranking del prototipo.
   */
  @Get('products-ranking')
  @ApiOperation({
    summary: 'Ranking de productos más vendidos',
    description:
      'Top 20 productos ordenados por cantidad de unidades vendidas. ' +
      'Incluye ventas del POS y consumos registrados en turnos (booking items).',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2025-03-15',
    description: 'Día exacto (tiene precedencia sobre dateFrom/dateTo).',
  })
  @ApiQuery({ name: 'dateFrom', required: false, example: '2025-03-01' })
  @ApiQuery({ name: 'dateTo', required: false, example: '2025-03-31' })
  @ApiResponse({ status: 200, description: 'Ranking de productos.' })
  getProductsRanking(@Query() query: ReportQueryDto) {
    return this.reportsService.getProductsRanking(query);
  }

  /**
   * GET /api/v1/reports/transactions/export?dateFrom=&dateTo=
   *
   * Historial plano de todos los movimientos de caja del período,
   * listo para ser exportado a CSV por el frontend (PapaParse, etc.).
   * Cada fila incluye: fecha, hora, tipo, concepto, efectivo, transferencia,
   * total y usuario que lo registró.
   */
  @Get('transactions/export')
  @ApiOperation({
    summary: 'Exportar historial de transacciones',
    description:
      'Retorna un array plano con todos los movimientos de caja del período. ' +
      'El frontend puede convertir este JSON a CSV sin dependencias adicionales.',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2025-03-15',
    description: 'Día exacto (tiene precedencia sobre dateFrom/dateTo).',
  })
  @ApiQuery({ name: 'dateFrom', required: false, example: '2025-03-01' })
  @ApiQuery({ name: 'dateTo', required: false, example: '2025-03-31' })
  @ApiResponse({ status: 200, description: 'Lista de transacciones para exportar.' })
  getTransactionsExport(@Query() query: ReportQueryDto) {
    return this.reportsService.getTransactionsExport(query);
  }
}
