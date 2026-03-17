import {
  Controller,
  Get,
  Put,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SystemConfigService } from './system-config.service';
import { UpdateConfigDto, BulkUpdateConfigDto } from './dto/update-config.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('Configuración')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('config')
export class SystemConfigController {
  constructor(private readonly configService: SystemConfigService) {}

  /**
   * GET /api/v1/config
   * Acceso: Admin y Empleado.
   * El Empleado necesita leer los precios para mostrarlos en la Agenda.
   */
  @Get()
  @ApiOperation({ summary: 'Obtener toda la configuración del sistema' })
  findAll() {
    return this.configService.findAll();
  }

  /**
   * PUT /api/v1/config/bulk
   * Actualización masiva desde el formulario de Configuración (solo admin).
   */
  @Put('bulk')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Actualizar múltiples configuraciones (solo admin)' })
  bulkUpdate(@Body() dto: BulkUpdateConfigDto) {
    return this.configService.bulkUpdate(dto.configs);
  }

  /**
   * PATCH /api/v1/config/:key
   * Actualización individual (solo admin).
   */
  @Patch(':key')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Actualizar una clave de configuración (solo admin)' })
  update(@Param('key') key: string, @Body() dto: UpdateConfigDto) {
    return this.configService.update(key, dto.value);
  }
}
