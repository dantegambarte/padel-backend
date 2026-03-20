import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import { CashRegisterService } from './cash-register.service';
import { CloseSessionDto } from './dto/close-session.dto';
import { OpenSessionDto } from './dto/open-session.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

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
   * POST /api/v1/cash/open
   *
   * Abre una nueva jornada de caja de forma manual.
   * El empleado declara el fondo de caja / cambio inicial.
   * Requiere que no exista ninguna sesión OPEN actualmente.
   *
   * Acceso: Admin y Empleado (cualquier usuario autenticado puede abrir caja).
   */
  @Post('open')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Abrir jornada de caja',
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
   * POST /api/v1/cash/close — Cierre Z
   *
   * Recibe el efectivo físico contado y cierra la sesión OPEN activa.
   * Devuelve el resumen del cierre con la diferencia calculada.
   * Después del cierre, cualquier intento de registrar cobros retornará 503.
   *
   * Acceso: Admin y Empleado (cualquier usuario autenticado puede cerrar caja).
   */
  @Post('close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cierre Z — Cerrar la jornada activa',
    description:
      'Calcula diferencia entre efectivo del sistema y el contado físicamente. ' +
      'Cierra la sesión OPEN y bloquea nuevos cobros hasta que se abra una nueva.',
  })
  @ApiResponse({ status: 200, description: 'Caja cerrada. Retorna el resumen del cierre.' })
  @ApiResponse({ status: 404, description: 'No hay sesión abierta.' })
  closeSession(@Body() dto: CloseSessionDto, @CurrentUser() user: User) {
    return this.cashRegisterService.closeSession(dto, user);
  }
}
