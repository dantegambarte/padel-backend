import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../users/entities/user.entity';

import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

/**
 * Controlador de Egresos.
 * POST / GET: ADMIN y EMPLOYEE. PATCH / DELETE: solo ADMIN.
 */
@ApiTags('Egresos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  /** Registra un nuevo egreso. Si el método de pago es Efectivo, vincula la sesión de caja activa. */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar un egreso' })
  create(@Body() dto: CreateExpenseDto, @CurrentUser() user: User) {
    return this.expensesService.create(dto, user.id, user.role);
  }

  /** Devuelve egresos filtrados por fecha. ADMIN ve todo; EMPLOYEE solo ve los de la jornada actual. */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'Listar egresos' })
  @ApiQuery({ name: 'from', required: false, example: '2025-03-01' })
  @ApiQuery({ name: 'to', required: false, example: '2025-03-31' })
  findAll(@CurrentUser() user: User, @Query('from') from?: string, @Query('to') to?: string) {
    return this.expensesService.findAll({ role: user.role, from, to });
  }

  /** Retorna el detalle de un egreso por ID. */
  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'Obtener un egreso por ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.expensesService.findOne(id);
  }

  /** Actualiza parcialmente un egreso existente. Solo ADMIN. */
  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Actualizar un egreso (solo admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateExpenseDto) {
    return this.expensesService.update(id, dto);
  }

  /** Elimina un egreso (soft delete). Solo ADMIN. */
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un egreso (soft delete, solo admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.expensesService.remove(id);
  }
}
