import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
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
  ApiParam,
} from '@nestjs/swagger';

import { FixedBookingsService } from './fixed-bookings.service';
import { CreateFixedBookingDto } from './dto/create-fixed-booking.dto';
import { UpdateFixedBookingDto } from './dto/update-fixed-booking.dto';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { User, UserRole } from '../users/entities/user.entity';

@ApiTags('Turnos Fijos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('fixed-bookings')
export class FixedBookingsController {
  constructor(private readonly fixedBookingsService: FixedBookingsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todos los turnos fijos (solo admin)' })
  @ApiResponse({ status: 200, description: 'Lista de turnos fijos.' })
  findAll() {
    return this.fixedBookingsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener detalle de un turno fijo (solo admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Detalle del turno fijo.' })
  @ApiResponse({ status: 404, description: 'No encontrado.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.fixedBookingsService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear un turno fijo (solo admin)',
    description: 'Genera automáticamente los turnos individuales para las próximas 8 semanas.',
  })
  @ApiResponse({ status: 201, description: 'Turno fijo creado.' })
  @ApiResponse({ status: 404, description: 'Cancha no encontrada.' })
  create(@Body() dto: CreateFixedBookingDto, @CurrentUser() user: User) {
    return this.fixedBookingsService.create(dto, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar un turno fijo (solo admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Turno fijo actualizado.' })
  @ApiResponse({ status: 404, description: 'No encontrado.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFixedBookingDto,
    @CurrentUser() user: User,
  ) {
    return this.fixedBookingsService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Desactivar un turno fijo (solo admin)',
    description: 'Soft-delete: marca el turno fijo como inactivo. Los turnos ya creados no se cancelan.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Turno fijo desactivado.' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.fixedBookingsService.deactivate(id);
  }

  @Delete(':id/cascade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Borrar en cascada un turno fijo (solo admin)',
    description:
      'Elimina todas las reservas futuras con estado "booked" asociadas a este turno fijo, ' +
      'luego elimina el turno fijo. Las reservas pasadas o en curso no se modifican.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Turno fijo y reservas futuras eliminados.' })
  @ApiResponse({ status: 404, description: 'Turno fijo no encontrado.' })
  deleteCascade(@Param('id', ParseUUIDPipe) id: string) {
    return this.fixedBookingsService.deleteCascade(id);
  }

  @Post(':id/generate')
  @ApiOperation({
    summary: 'Generar próximos turnos de un turno fijo (solo admin)',
    description: 'Dispara la generación manual de Bookings para las próximas 8 semanas.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Cantidad de turnos generados.' })
  generateNext(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.fixedBookingsService.generateNext(id, user);
  }
}
