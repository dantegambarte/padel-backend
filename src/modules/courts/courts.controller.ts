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
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { CourtsService } from './courts.service';
import { BulkPricesDto, CreateCourtDto, UpdateCourtDto } from './dto/create-court.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('Canchas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('courts')
export class CourtsController {
  constructor(private readonly courtsService: CourtsService) {}

  /**
   * GET /api/v1/courts
   * Acceso: Admin y Empleado (el empleado necesita la lista para la Agenda).
   * ?onlyActive=true → filtra solo canchas activas
   */
  @Get()
  @ApiOperation({ summary: 'Listar canchas' })
  @ApiQuery({ name: 'onlyActive', required: false, type: Boolean })
  findAll(@Query('onlyActive') onlyActive?: boolean) {
    return this.courtsService.findAll(onlyActive);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una cancha por ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.courtsService.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Crear una nueva cancha (solo admin)' })
  create(@Body() dto: CreateCourtDto) {
    return this.courtsService.create(dto);
  }

  @Patch('bulk-prices')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Actualizar precios de múltiples canchas en una sola operación (solo admin)' })
  bulkUpdatePrices(@Body() dto: BulkPricesDto) {
    return this.courtsService.bulkUpdatePrices(dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Actualizar una cancha (solo admin)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCourtDto) {
    return this.courtsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Eliminar una cancha (solo admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.courtsService.remove(id);
  }
}
