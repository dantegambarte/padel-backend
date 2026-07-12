import {
  Controller,
  Get,
  Post,
  Patch,
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
import { AddSaleItemsDto } from './dto/add-sale-items.dto';
import { PaySaleDto } from './dto/pay-sale.dto';
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
   * GET /api/v1/sales/open
   * Lista las cuentas abiertas (torneos/jornadas largas) sin importar la fecha.
   * DEBE declararse antes de GET /sales/:id para que "open" no matchee como :id.
   */
  @Get('open')
  @ApiOperation({
    summary: 'Listar cuentas abiertas',
    description: 'Ventas con status "open": stock ya descontado, cobro pendiente.',
  })
  findOpenSales() {
    return this.posService.findOpenSales();
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

  /**
   * PATCH /api/v1/sales/:id/add-items
   * Agrega productos a una cuenta abierta existente. Descuenta stock al
   * instante, igual que en la creación. La venta debe estar en status 'open'.
   */
  @Patch(':id/add-items')
  @ApiOperation({
    summary: 'Agregar items a una cuenta abierta',
    description: 'Descuenta stock al instante. Falla si la venta no está en status "open".',
  })
  @ApiResponse({ status: 200, description: 'Items agregados.' })
  @ApiResponse({ status: 400, description: 'La venta no está abierta o stock insuficiente.' })
  addItems(@Param('id') id: string, @Body() dto: AddSaleItemsDto) {
    return this.posService.addItems(id, dto);
  }

  /**
   * POST /api/v1/sales/:id/pay
   * Cobra y cierra una cuenta abierta: valida el pago, marca status 'paid'
   * y registra el movimiento en la sesión de caja ACTIVA del empleado.
   */
  @Post(':id/pay')
  @ApiOperation({
    summary: 'Cobrar y cerrar una cuenta abierta',
    description: 'Marca la venta como "paid" y genera la transacción en la sesión de caja actual.',
  })
  @ApiResponse({ status: 200, description: 'Cuenta cobrada y cerrada.' })
  @ApiResponse({
    status: 400,
    description: 'La venta no está abierta, ya fue cobrada, o pago insuficiente.',
  })
  pay(@Param('id') id: string, @Body() dto: PaySaleDto, @CurrentUser() user: User) {
    return this.posService.pay(id, dto, user);
  }
}
