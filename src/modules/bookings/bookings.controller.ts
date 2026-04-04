import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';

import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { QueryBookingsDto } from './dto/query-bookings.dto';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { User, UserRole } from '../users/entities/user.entity';

@ApiTags('Agenda / Turnos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  /**
   * GET /api/v1/bookings?date=YYYY-MM-DD[&courtId=uuid]
   *
   * Datos de la grilla diaria. El frontend Angular los recibe y arma
   * la matriz [cancha][hora] → estado del slot.
   *
   * Acceso: Admin y Empleado.
   */
  @Get()
  @ApiOperation({
    summary: 'Obtener turnos del día (grilla)',
    description:
      'Retorna todos los turnos de una fecha. El frontend construye la grilla con esta respuesta.',
  })
  @ApiResponse({ status: 200, description: 'Lista de turnos del día.' })
  @ApiResponse({ status: 400, description: 'Formato de fecha inválido.' })
  findByDate(@Query() query: QueryBookingsDto) {
    return this.bookingsService.findByDate(query);
  }

  /**
   * POST /api/v1/bookings/migration/backfill-shift-names
   *
   * Backfill de una sola ejecución: calcula y rellena `appliedShiftName`
   * en todas las reservas históricas donde el campo sea NULL.
   * Es idempotente — puede ejecutarse más de una vez sin efectos secundarios.
   *
   * Acceso: solo Admin.
   */
  @Post('migration/backfill-shift-names')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: '[Admin] Backfill de nombres de franja horaria',
    description:
      'Calcula y persiste appliedShiftName en todas las reservas con valor NULL. ' +
      'Operación idempotente de una sola ejecución. Solo administradores.',
  })
  @ApiResponse({ status: 200, description: '{ updated: number }' })
  @ApiResponse({ status: 403, description: 'Solo administradores.' })
  backfillShiftNames() {
    return this.bookingsService.backfillShiftNames();
  }

  /**
   * GET /api/v1/bookings/:id
   * Detalle de un turno específico (para el modal de edición).
   */
  @Get(':id')
  @ApiOperation({ summary: 'Obtener detalle de un turno' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.findOne(id);
  }

  /**
   * POST /api/v1/bookings
   *
   * Crea un turno nuevo con lógica transaccional completa:
   * - Advisory lock en PostgreSQL
   * - SELECT FOR UPDATE en el slot
   * - Descuento de stock de productos del buffet
   * - Registro del pago (parcial o total)
   *
   * Errores posibles:
   *   409 Conflict   → slot ya ocupado
   *   400 Bad Request → stock insuficiente
   *   404 Not Found  → cancha o producto inexistente
   *
   * Acceso: Admin y Empleado.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear un nuevo turno',
    description: 'Operación transaccional. Anti-overbooking garantizado.',
  })
  @ApiResponse({ status: 201, description: 'Turno creado exitosamente.' })
  @ApiResponse({
    status: 409,
    description: 'El slot ya está reservado (overbooking bloqueado).',
  })
  @ApiResponse({
    status: 400,
    description: 'Stock insuficiente para algún producto del buffet.',
  })
  create(@Body() createBookingDto: CreateBookingDto, @CurrentUser() user: User) {
    return this.bookingsService.create(createBookingDto, user);
  }

  /**
   * PATCH /api/v1/bookings/:id
   *
   * Actualización parcial de un turno. Casos de uso:
   *   - Cambiar estado (booked → playing → completed)
   *   - Agregar/modificar productos del buffet
   *   - Registrar pago adicional (completar una seña)
   *   - Cambiar nombre del cliente
   *
   * Si se modifican items: se restaura el stock anterior y se descuenta
   * el nuevo, todo en la misma transacción.
   *
   * Acceso: Admin y Empleado (con restricciones según estado).
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Actualizar un turno',
    description:
      'Admite actualización parcial. Si se modifican items, el stock se recalcula en una sola transacción.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Turno actualizado.' })
  @ApiResponse({
    status: 400,
    description: 'Transición de estado inválida o stock insuficiente.',
  })
  @ApiResponse({ status: 403, description: 'Sin permisos para esta operación.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateBookingDto: UpdateBookingDto,
    @CurrentUser() user: User,
  ) {
    return this.bookingsService.update(id, updateBookingDto, user);
  }

  /**
   * DELETE /api/v1/bookings/:id
   *
   * Cancelación lógica de un turno (status = CANCELLED).
   * Restaura el stock de todos los productos del buffet.
   *
   * SOLO ADMIN: un empleado no puede cancelar turnos pagados.
   */
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Cancelar un turno (solo admin)',
    description: 'Cancelación lógica. Restaura el stock de productos del buffet automáticamente.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Turno cancelado.' })
  @ApiResponse({ status: 403, description: 'Solo administradores.' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.bookingsService.cancel(id, user);
  }
}
