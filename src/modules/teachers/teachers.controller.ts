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
  ParseBoolPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

import { TeachersService } from './teachers.service';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';
import { LiquidateTeacherDto } from './dto/liquidate-teacher.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('Profesores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('teachers')
export class TeachersController {
  constructor(private readonly teachersSvc: TeachersService) {}

  /**
   * GET /teachers
   * Sin parámetros   → solo profesores activos (todos los roles autenticados).
   * ?includeInactive=true → activos + inactivos (exclusivo para admin).
   */
  @Get()
  @ApiOperation({
    summary: 'Listar profesores (activos por defecto; admin puede incluir inactivos)',
  })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
    description: 'true = incluir inactivos (solo admin)',
  })
  @ApiResponse({ status: 200, description: 'Lista de profesores.' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — solo admin puede pedir includeInactive=true.',
  })
  findAll(
    @Query('includeInactive', new DefaultValuePipe(false), ParseBoolPipe) includeInactive: boolean,
    @CurrentUser('role') role: UserRole,
  ) {
    const effectiveIncludeInactive = role === UserRole.ADMIN ? includeInactive : false;
    return this.teachersSvc.findAll(effectiveIncludeInactive);
  }

  /**
   * GET /teachers/:id/report?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
   * Genera el reporte de liquidación de un profesor. Solo admin.
   * Nota: esta ruta debe ir ANTES de `:id` para que el router no interprete
   * "report" como un UUID.
   */
  @Get(':id/report')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Reporte de liquidación de un profesor (admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'startDate', required: true, type: String, example: '2025-01-01' })
  @ApiQuery({ name: 'endDate', required: true, type: String, example: '2025-01-31' })
  getReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.teachersSvc.getReport(id, startDate, endDate);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un profesor por id' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 404, description: 'No encontrado.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.teachersSvc.findOne(id);
  }

  /**
   * POST /teachers/liquidate
   * Liquida turnos + consumos de un profesor en una sola transacción de caja.
   * Requiere caja abierta.
   */
  @Post('liquidate')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Liquidar deuda unificada de un profesor (admin)' })
  liquidate(@Body() dto: LiquidateTeacherDto, @CurrentUser('id') userId: string) {
    return this.teachersSvc.liquidate(dto, userId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Crear profesor (admin)' })
  create(@Body() dto: CreateTeacherDto) {
    return this.teachersSvc.create(dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Actualizar profesor (admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTeacherDto) {
    return this.teachersSvc.update(id, dto);
  }

  /**
   * DELETE /teachers/:id
   * Soft-delete: marca isActive = false.
   */
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desactivar profesor (admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.teachersSvc.deactivate(id);
  }
}
