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
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('Productos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /**
   * GET /api/v1/products
   * Acceso: Admin (con precios de costo) y Empleado (sin precios de costo).
   * El frontend diferencia lo que muestra según el rol del token.
   */
  @Get()
  @ApiOperation({
    summary: 'Listar productos',
    description:
      'Soporta filtros: ?search=agua, ?categoryId=uuid, ?lowStock=true, ?onlyActive=false',
  })
  findAll(@Query() query: QueryProductsDto) {
    return this.productsService.findAll(query);
  }

  /**
   * GET /api/v1/products/featured
   * Productos destacados para el modal de Agenda (botones de acceso rápido).
   * Solo retorna productos activos con isFeatured = true.
   * Acceso: Admin y Empleado.
   */
  @Get('featured')
  @ApiOperation({
    summary: 'Listar productos destacados (para modal de Agenda)',
  })
  findFeatured() {
    return this.productsService.findFeatured();
  }

  /**
   * GET /api/v1/products/low-stock
   * Productos con stock < minStock. Alimenta las alertas del Dashboard Empleado.
   */
  @Get('low-stock')
  @ApiOperation({ summary: 'Productos con stock bajo el mínimo (alertas)' })
  findLowStock() {
    return this.productsService.findLowStock();
  }

  /**
   * GET /api/v1/products/categories
   * Listado de categorías disponibles para el formulario de alta de producto.
   */
  @Get('categories')
  @ApiOperation({ summary: 'Listar categorías de productos' })
  findCategories() {
    return this.productsService.findAllCategories();
  }

  /**
   * POST /api/v1/products/categories — Solo Admin
   * Crea una categoría si no existe (idempotente por nombre).
   */
  @Post('categories')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear categoría de producto (solo admin)' })
  createCategory(@Body() body: { name: string }) {
    if (!body?.name?.trim()) {
      throw new BadRequestException('El nombre de la categoría es requerido.');
    }
    return this.productsService.createCategory(body.name);
  }

  /**
   * GET /api/v1/products/summary
   * Estadísticas de inventario para el widget de la página de Productos.
   */
  @Get('summary')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Resumen estadístico del inventario (solo admin)' })
  getSummary() {
    return this.productsService.getSummary();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un producto por ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findOne(id);
  }

  /**
   * POST /api/v1/products — Solo Admin
   */
  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear producto (solo admin)' })
  @ApiResponse({ status: 201, description: 'Producto creado.' })
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  /**
   * PATCH /api/v1/products/:id — Solo Admin
   * Usado para editar datos Y para ajustes manuales de stock (reposición).
   */
  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Actualizar producto (solo admin)',
    description: 'Para reposición de stock, enviar solo el campo "stock" con el nuevo valor total.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  /**
   * DELETE /api/v1/products/:id — Solo Admin
   * Baja lógica: isActive = false. El producto queda en el historial.
   */
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desactivar producto (baja lógica, solo admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.remove(id);
  }
}
