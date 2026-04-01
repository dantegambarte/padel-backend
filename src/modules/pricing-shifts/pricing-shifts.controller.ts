import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { PricingShiftsService } from './pricing-shifts.service';
import { CreatePricingShiftDto } from './dto/create-pricing-shift.dto';
import { UpdatePricingShiftDto } from './dto/update-pricing-shift.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('Franjas Horarias de Precios')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('pricing-shifts')
export class PricingShiftsController {
  constructor(private readonly service: PricingShiftsService) {}

  /**
   * GET /api/v1/pricing-shifts
   * Todas las franjas (activas e inactivas). Solo Admin.
   */
  @Get()
  @ApiOperation({ summary: 'Listar todas las franjas horarias' })
  findAll() {
    return this.service.findAll();
  }

  /**
   * GET /api/v1/pricing-shifts/active
   * Solo franjas activas. Accesible por Admin y Empleado (para previsualizar precios).
   */
  @Get('active')
  @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'Franjas activas — visible para empleados y admins' })
  findActive() {
    return this.service.findActive();
  }

  /**
   * GET /api/v1/pricing-shifts/:id
   */
  @Get(':id')
  @ApiOperation({ summary: 'Obtener una franja por ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  /**
   * POST /api/v1/pricing-shifts
   */
  @Post()
  @ApiOperation({ summary: 'Crear nueva franja horaria' })
  @ApiResponse({ status: 201, description: 'Franja creada exitosamente.' })
  create(@Body() dto: CreatePricingShiftDto) {
    return this.service.create(dto);
  }

  /**
   * PATCH /api/v1/pricing-shifts/:id
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar una franja horaria' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePricingShiftDto,
  ) {
    return this.service.update(id, dto);
  }

  /**
   * DELETE /api/v1/pricing-shifts/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar una franja horaria' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
