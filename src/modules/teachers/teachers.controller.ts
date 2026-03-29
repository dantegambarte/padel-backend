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
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';

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
   * Devuelve solo profesores activos (usado por todos los roles para llenar selects).
   */
  @Get()
  @ApiOperation({ summary: 'Listar profesores activos' })
  @ApiResponse({ status: 200, description: 'Lista de profesores activos.' })
  findAll() {
    return this.teachersSvc.findAll();
  }

  /**
   * GET /teachers/all
   * Devuelve todos los profesores incluyendo inactivos (admin).
   */
  @Get('all')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Listar todos los profesores (admin)' })
  findAllIncludingInactive() {
    return this.teachersSvc.findAllIncludingInactive();
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
