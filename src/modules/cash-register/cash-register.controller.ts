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
   * Alimenta la vista de Caja del prototipo:
   *  - Cards: "Efectivo Esperado", "Transferencias", "Total del Día"
   *  - Tabla: "Movimientos del Día" (historial con hora, concepto, método, monto)
   *  - Estado de la sesión (para bloquear el input si ya está cerrada)
   */
  @Get('current')
  @ApiOperation({
    summary: 'Estado actual de la caja del día',
    description:
      'Retorna efectivo esperado, transferencias, total y listado de movimientos. ' +
      'Sin ?date retorna el día de hoy.',
  })
  @ApiQuery({ name: 'date', required: false, example: '2025-03-15' })
  @ApiResponse({
    status: 200,
    description: 'Estado de caja. session: null si no hubo operaciones hoy.',
  })
  getCurrentSession(@Query() query: CashQueryDto) {
    return this.cashRegisterService.getCurrentSession(query.date);
  }

  /**
   * POST /api/v1/cash/close — Cierre Z
   *
   * Recibe el efectivo físico contado y cierra la sesión del día.
   * Devuelve el resumen del cierre con la diferencia calculada.
   *
   * Después del cierre, cualquier intento de crear un turno o una venta
   * del mismo día retornará 503 Service Unavailable.
   *
   * Acceso: Admin y Empleado (cualquier usuario autenticado puede cerrar caja).
   */
  @Post('close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cierre Z — Cerrar la caja del día',
    description:
      'Calcula diferencia entre efectivo del sistema y el contado físicamente. ' +
      'Bloquea nuevas operaciones para el día.',
  })
  @ApiResponse({ status: 200, description: 'Caja cerrada. Retorna el resumen del cierre.' })
  @ApiResponse({ status: 404, description: 'No hay sesión abierta hoy.' })
  @ApiResponse({ status: 409, description: 'La caja ya fue cerrada hoy.' })
  closeSession(
    @Body() dto: CloseSessionDto,
    @CurrentUser() user: User,
  ) {
    return this.cashRegisterService.closeSession(dto, user);
  }
}
