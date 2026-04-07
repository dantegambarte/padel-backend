import { Controller, Get, Query, UseGuards, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
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
   * GET /api/v1/reports/kpis[?date=YYYY-MM-DD]
   *
   * KPIs del día actual para el Dashboard Admin:
   *   - Ingresos totales de hoy (efectivo + transferencia)
   *   - Turnos completados y tasa de ocupación
   *   - Unidades de productos vendidos
   *
   * Si no se envía `date`, se asume la sesión de caja activa (hoy).
   */
  @Get('kpis')
  @ApiOperation({ summary: 'KPIs de caja para el Dashboard Admin' })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2025-03-15',
    description: 'Día a consultar (YYYY-MM-DD). Por defecto: sesión activa de hoy.',
  })
  @ApiResponse({ status: 200, description: 'Métricas del día solicitado.' })
  getKpis(@Query('date') date?: string) {
    return this.reportsService.getKpis(date);
  }

  /**
   * GET /api/v1/reports/revenue/trend?days=7
   *
   * Ingresos de los últimos N días desglosados en Efectivo y Transferencia.
   * Alimenta el gráfico de barras del Dashboard Admin.
   * Por defecto `days=7`.
   */
  @Get('revenue/trend')
  @ApiOperation({ summary: 'Tendencia de ingresos diarios por método de pago' })
  @ApiQuery({
    name: 'days',
    required: false,
    example: 7,
    description: 'Número de días hacia atrás a incluir (default: 7).',
  })
  @ApiResponse({ status: 200, description: 'Array de días con cash/transfer/total.' })
  getRevenueTrend(@Query('days', new DefaultValuePipe(7), ParseIntPipe) days: number) {
    return this.reportsService.getRevenueTrend(days);
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
   * GET /api/v1/reports/expenses?dateFrom=&dateTo=
   *
   * Listado de egresos del período con totales agregados por categoría
   * y método de pago. Solo accesible para el rol ADMIN.
   */
  @Get('expenses')
  @ApiOperation({
    summary: 'Reporte de egresos del período',
    description: 'Devuelve el listado de egresos con totales por categoría y método de pago.',
  })
  @ApiQuery({ name: 'date', required: false, example: '2025-03-15' })
  @ApiQuery({ name: 'dateFrom', required: false, example: '2025-03-01' })
  @ApiQuery({ name: 'dateTo', required: false, example: '2025-03-31' })
  @ApiResponse({ status: 200, description: 'Reporte de egresos.' })
  getExpenses(@Query() query: ReportQueryDto) {
    return this.reportsService.getExpenses(query);
  }

  /**
   * GET /api/v1/reports/low-stock
   *
   * Devuelve los productos activos cuyo stock es igual o menor al umbral mínimo.
   * Utilizado por el widget de alertas en el Dashboard Admin.
   */
  @Get('low-stock')
  @ApiOperation({ summary: 'Productos con stock bajo o agotado' })
  @ApiResponse({ status: 200, description: 'Lista de productos en alerta de stock.' })
  getLowStock() {
    return this.reportsService.getLowStock();
  }

  @Get('transactions')
  @ApiOperation({
    summary: 'Historial de transacciones (exportable)',
    description:
      'Retorna un array plano con todos los movimientos de caja del período. ' +
      'Usar ?format=csv como indicador semántico; la conversión a CSV la realiza el frontend.',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2025-03-15',
    description: 'Día exacto (tiene precedencia sobre dateFrom/dateTo).',
  })
  @ApiQuery({ name: 'dateFrom', required: false, example: '2025-03-01' })
  @ApiQuery({ name: 'dateTo', required: false, example: '2025-03-31' })
  @ApiResponse({ status: 200, description: 'Lista de transacciones.' })
  getTransactions(@Query() query: ReportQueryDto) {
    return this.reportsService.getTransactionsExport(query);
  }
}
