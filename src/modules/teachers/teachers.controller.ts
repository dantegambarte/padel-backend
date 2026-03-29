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
  ForbiddenException,
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
  @ApiOperation({ summary: 'Listar profesores (activos por defecto; admin puede incluir inactivos)' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean, description: 'true = incluir inactivos (solo admin)' })
  @ApiResponse({ status: 200, description: 'Lista de profesores.' })
  @ApiResponse({ status: 403, description: 'Forbidden — solo admin puede pedir includeInactive=true.' })
  findAll(
    @Query('includeInactive', new DefaultValuePipe(false), ParseBoolPipe) includeInactive: boolean,
    @CurrentUser('role') role: UserRole,
  ) {
    if (includeInactive && role !== UserRole.ADMIN) {
      throw new ForbiddenException('Solo administradores pueden listar profesores inactivos.');
    }
    return this.teachersSvc.findAll(includeInactive);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un profesor por id' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 404, description: 'No encontrado.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.teachersSvc.findOne(id);
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
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeacherDto,
  ) {
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
