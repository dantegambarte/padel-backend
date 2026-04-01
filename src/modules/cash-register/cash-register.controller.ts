import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Query,
  Param,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import { CashRegisterService } from './cash-register.service';
import { CloseSessionDto } from './dto/close-session.dto';
import { OpenSessionDto } from './dto/open-session.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../users/entities/user.entity';

class CashQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}

@ApiTags('Caja')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cash')
export class CashRegisterController {
  constructor(private readonly cashRegisterService: CashRegisterService) {}

  /**
   * GET /api/v1/cash/current?date=YYYY-MM-DD
   *
   * Alimenta la pantalla de Caja:
   *  - Si hay sesión OPEN → muestra el Dashboard de arqueo de la jornada activa.
   *  - Si no hay sesión OPEN (o está cerrada) → session: null → frontend muestra "Apertura de Caja".
   *  - Con ?date → consulta histórica (puede devolver sesión CLOSED).
   */
  @Get('current')
  @ApiOperation({
    summary: 'Estado actual de la sesión de caja',
    description:
      'Retorna la sesión OPEN activa (sin importar si cruzó la medianoche), ' +
      'o la sesión CLOSED del día comercial actual. ' +
      'Si no hay sesión → session: null (mostrar pantalla de Apertura).',
  })
  @ApiQuery({ name: 'date', required: false, example: '2025-03-15' })
  @ApiResponse({
    status: 200,
    description: 'Estado de la sesión de caja. session: null si no hay ninguna.',
  })
  getCurrentSession(@Query() query: CashQueryDto) {
    return this.cashRegisterService.getCurrentSession(query.date);
  }

  /**
   * GET /api/v1/cash/sessions/suggestion
   *
   * Devuelve el efectivo físico contado en el último turno cerrado,
   * para pre-cargar el "Fondo Inicial" del próximo turno (arrastre de fondo).
   * Retorna `{ cashCounted: null }` si nunca hubo ningún cierre.
   */
  @Get('sessions/suggestion')
  @ApiOperation({ summary: 'Fondo inicial sugerido (arrastre del último cierre)' })
  @ApiResponse({ status: 200, description: '{ cashCounted: number | null }' })
  getLastClosedSuggestion() {
    return this.cashRegisterService.getLastClosedSuggestion();
  }

  /**
   * POST /api/v1/cash/sessions
   *
   * Abre una nueva jornada de caja de forma manual.
   * El empleado declara el fondo de caja / cambio inicial.
   * Requiere que no exista ninguna sesión OPEN actualmente.
   *
   * Acceso: Admin y Empleado (cualquier usuario autenticado puede abrir caja).
   */
  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Abrir jornada de caja — Crear sesión',
    description:
      'Crea una nueva sesión de caja OPEN para la jornada comercial vigente. ' +
      'Registra el fondo de caja inicial declarado por el empleado. ' +
      'Falla con 409 si ya existe una sesión abierta.',
  })
  @ApiResponse({ status: 201, description: 'Sesión de caja abierta exitosamente.' })
  @ApiResponse({ status: 409, description: 'Ya existe una sesión de caja abierta.' })
  openSession(@Body() dto: OpenSessionDto, @CurrentUser() user: User) {
    return this.cashRegisterService.openSession(dto, user);
  }

  /**
   * PATCH /api/v1/cash/sessions/current — Cierre Z
   *
   * Recibe el efectivo físico contado y cierra la sesión OPEN activa.
   * Devuelve el resumen del cierre con la diferencia calculada.
   * Después del cierre, cualquier intento de registrar cobros retornará 503.
   *
   * Acceso: Admin y Empleado (cualquier usuario autenticado puede cerrar caja).
   */
  @Patch('sessions/current')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cierre de Turno — Cerrar la sesión activa',
    description:
      'Calcula diferencia entre efectivo del sistema y el contado físicamente. ' +
      'Cierra la sesión OPEN y bloquea nuevos cobros hasta que se abra una nueva.',
  })
  @ApiResponse({ status: 200, description: 'Turno cerrado. Retorna el resumen del cierre.' })
  @ApiResponse({ status: 404, description: 'No hay sesión abierta.' })
  closeSession(@Body() dto: CloseSessionDto, @CurrentUser() user: User) {
    return this.cashRegisterService.closeSession(dto, user);
  }

  /**
   * POST /api/v1/cash/daily-closures
   *
   * Cierre de Jornada Completa (Cierre Z Día).
   * Valida que no haya ningún turno abierto y devuelve el consolidado del día comercial actual.
   * Si hay un turno abierto responde 409 — el cajero debe cerrarlo antes.
   *
   * Acceso: Admin y Employee (el empleado del turno noche cierra físicamente el club).
   */
  @Post('daily-closures')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
  @ApiOperation({
    summary: 'Cierre de Jornada Completa — Crear cierre diario',
    description:
      'Verifica que no exista ningún turno abierto y retorna el consolidado del día comercial actual. ' +
      'Falla con 409 si hay algún turno OPEN.',
  })
  @ApiResponse({ status: 200, description: 'Consolidado del día. Todos los turnos están cerrados.' })
  @ApiResponse({ status: 409, description: 'Hay un turno abierto. Cerrarlo antes de proceder.' })
  @ApiResponse({ status: 403, description: 'Acceso denegado.' })
  closeDay() {
    return this.cashRegisterService.closeDay();
  }

  /**
   * GET /api/v1/cash/daily-summary?date=YYYY-MM-DD
   *
   * Consolidado diario para el Administrador.
   * Devuelve TODAS las sesiones (turnos) del día comercial indicado,
   * con los totales de cada turno y el agregado del día.
   *
   * Acceso: solo Admin.
   */
  @Get('daily-summary')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Consolidado diario — Cierre Z del Administrador',
    description:
      'Devuelve todas las sesiones de caja del día comercial indicado. ' +
      'Si no se especifica fecha se usa el día comercial actual. ' +
      'Requiere rol Admin.',
  })
  @ApiQuery({ name: 'date', required: false, example: '2025-03-15' })
  @ApiResponse({ status: 200, description: 'Consolidado diario con desglose por turno.' })
  @ApiResponse({ status: 400, description: 'Formato de fecha inválido.' })
  @ApiResponse({ status: 403, description: 'Solo administradores.' })
  getDailySummary(@Query('date') date?: string) {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('El parámetro date debe tener formato YYYY-MM-DD.');
    }
    const targetDate = date ?? this.cashRegisterService.getBusinessDate();
    return this.cashRegisterService.getDailySummary(targetDate);
  }

  /**
   * GET /api/v1/cash/export/session/:id — Cierre X
   *
   * Genera y descarga el Excel de un turno específico.
   * Incluye resumen de sesión (cajero, fechas, totales, diferencia)
   * y el detalle completo de transacciones.
   *
   * Acceso: Admin.
   */
  @Get('export/session/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Exportar Turno X a Excel',
    description: 'Genera el archivo .xlsx de un turno específico con resumen y detalle de transacciones.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la sesión de caja' })
  @ApiResponse({ status: 200, description: 'Archivo Excel generado correctamente.' })
  @ApiResponse({ status: 404, description: 'Sesión no encontrada.' })
  @ApiResponse({ status: 403, description: 'Solo administradores.' })
  async exportSession(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.cashRegisterService.generateSessionExcel(id);
    const filename = `Cierre_Turno_X_${id.substring(0, 8)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  /**
   * GET /api/v1/cash/export/daily?date=YYYY-MM-DD — Cierre Z Consolidado
   *
   * Genera y descarga el Excel consolidado de toda la jornada.
   * Incluye totales del día y el desglose por cada turno.
   *
   * Acceso: Admin.
   */
  @Get('export/daily')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Exportar Jornada Z a Excel',
    description: 'Genera el archivo .xlsx consolidado de todos los turnos de una jornada.',
  })
  @ApiQuery({ name: 'date', required: true, example: '2025-03-15' })
  @ApiResponse({ status: 200, description: 'Archivo Excel generado correctamente.' })
  @ApiResponse({ status: 400, description: 'Formato de fecha inválido.' })
  @ApiResponse({ status: 403, description: 'Solo administradores.' })
  async exportDaily(
    @Query('date') date: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('El parámetro date debe tener formato YYYY-MM-DD.');
    }
    const buffer = await this.cashRegisterService.generateDailyExcel(date);
    const filename = `Cierre_Jornada_Z_${date}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }
}
