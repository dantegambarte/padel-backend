import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import { PosService } from './pos.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

class SalesQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}

@ApiTags('POS / Ventas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sales')
export class PosController {
  constructor(private readonly posService: PosService) {}

  /**
   * GET /api/v1/sales?date=YYYY-MM-DD
   * Historial de ventas del día. Usado en la vista de Caja para el
   * desglose de movimientos de tipo "Venta".
   */
  @Get()
  @ApiOperation({
    summary: 'Listar ventas del día',
    description: 'Filtra por fecha. Sin fecha, retorna las ventas de hoy.',
  })
  @ApiQuery({ name: 'date', required: false, example: '2025-03-15' })
  findByDate(@Query() query: SalesQueryDto) {
    const date = query.date ?? new Date().toISOString().split('T')[0];
    return this.posService.findByDate(date);
  }

  /**
   * GET /api/v1/sales/:id
   * Detalle completo de una venta: items, productos, montos de pago y cliente.
   * Usado por el modal de Comanda de Consumo en el Cierre de Caja.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Obtener detalle de una venta por ID' })
  @ApiResponse({ status: 200, description: 'Detalle de la venta.' })
  @ApiResponse({ status: 404, description: 'Venta no encontrada.' })
  findOne(@Param('id') id: string) {
    return this.posService.findOneWithDetails(id);
  }

  /**
   * POST /api/v1/sales
   *
   * Crea una venta con transacción atómica:
   *   1. SELECT FOR UPDATE en cada producto del carrito
   *   2. Verificación de stock (400 si insuficiente + rollback)
   *   3. Snapshot del precio en SaleItem.unitPrice
   *   4. Decremento de stock
   *   5. [FASE 5] Registro del movimiento en Caja
   *   6. COMMIT
   *
   * Acceso: Admin y Empleado.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Confirmar venta (POS)',
    description:
      'Operación transaccional. Decrementa stock y crea el historial de venta con precio histórico congelado.',
  })
  @ApiResponse({ status: 201, description: 'Venta confirmada.' })
  @ApiResponse({
    status: 400,
    description: 'Stock insuficiente (indica qué producto) o pago insuficiente.',
  })
  create(
    @Body() dto: CreateSaleDto,
    @CurrentUser() user: User,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ) {
    return this.posService.create(dto, user, idempotencyKey);
  }
}
