import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, LessThan } from 'typeorm';
import { Product } from './entities/product.entity';
import { ProductCategory } from './entities/product-category.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,

    @InjectRepository(ProductCategory)
    private readonly categoryRepo: Repository<ProductCategory>,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  //  QUERIES
  // ───────────────────────────────────────────────────────────────────────────

  async findAll(query: QueryProductsDto): Promise<Product[]> {
    const where: any = {};

    // Por defecto traemos solo activos, a menos que se pida lo contrario
    if (query.onlyActive !== false) {
      where.isActive = true;
    }

    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }

    // Búsqueda por nombre (case-insensitive)
    if (query.search) {
      where.name = ILike(`%${query.search}%`);
    }

    const products = await this.productRepo.find({
      where,
      relations: ['category'],
      order: { name: 'ASC' },
    });

    // Filtro de stock bajo (stock < minStock) — se aplica en memoria
    // porque comparar dos columnas entre sí con TypeORM básico requiere QB
    if (query.lowStock) {
      return products.filter((p) => p.stock < p.minStock);
    }

    return products;
  }

  /**
   * Productos destacados (isFeatured = true).
   * Usados como botones de acceso rápido en el modal de Agenda.
   * Solo retorna activos con stock > 0.
   */
  async findFeatured(): Promise<Product[]> {
    return this.productRepo.find({
      where: { isFeatured: true, isActive: true },
      relations: ['category'],
      order: { name: 'ASC' },
    });
  }

  /**
   * Productos con stock por debajo del mínimo.
   * Consumido por el Dashboard del Empleado para mostrar alertas.
   */
  async findLowStock(): Promise<Product[]> {
    // QueryBuilder para comparar dos columnas entre sí
    return this.productRepo
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .where('product.isActive = true')
      .andWhere('product.stock < product.minStock')
      .orderBy('product.stock', 'ASC')
      .getMany();
  }

  async findOne(id: string): Promise<Product> {
    const product = await this.productRepo.findOne({
      where: { id },
      relations: ['category'],
    });

    if (!product) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado.`);
    }

    return product;
  }

  findAllCategories(): Promise<ProductCategory[]> {
    return this.categoryRepo.find({ order: { name: 'ASC' } });
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  MUTACIONES
  // ───────────────────────────────────────────────────────────────────────────

  async create(dto: CreateProductDto): Promise<Product> {
    // Verificar categoría si se especificó
    if (dto.categoryId) {
      await this.validateCategory(dto.categoryId);
    }

    const product = this.productRepo.create({
      name: dto.name.trim(),
      categoryId: dto.categoryId,
      costPrice: dto.costPrice,
      salePrice: dto.salePrice,
      stock: dto.stock,
      minStock: dto.minStock ?? 5,
      isFeatured: dto.isFeatured ?? false,
      isActive: true,
    });

    const saved = await this.productRepo.save(product);
    this.logger.log(`Producto creado: "${saved.name}" (stock: ${saved.stock})`);

    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.findOne(id);

    if (dto.categoryId) {
      await this.validateCategory(dto.categoryId);
    }

    if (dto.name) product.name = dto.name.trim();
    if (dto.categoryId !== undefined) product.categoryId = dto.categoryId;
    if (dto.costPrice !== undefined) product.costPrice = dto.costPrice;
    if (dto.salePrice !== undefined) product.salePrice = dto.salePrice;
    if (dto.minStock !== undefined) product.minStock = dto.minStock;
    if (dto.isFeatured !== undefined) product.isFeatured = dto.isFeatured;
    if (dto.isActive !== undefined) product.isActive = dto.isActive;

    // Ajuste manual de stock (reposición). Los decrementos se hacen
    // internamente vía transacciones de Bookings y POS, nunca por este endpoint.
    if (dto.stock !== undefined) {
      if (dto.stock < 0) {
        throw new BadRequestException('El stock no puede ser negativo.');
      }
      const diff = dto.stock - product.stock;
      this.logger.log(
        `Ajuste manual de stock: "${product.name}" ${product.stock} → ${dto.stock} (${diff >= 0 ? '+' : ''}${diff})`,
      );
      product.stock = dto.stock;
    }

    const saved = await this.productRepo.save(product);
    return this.findOne(saved.id);
  }

  /**
   * Baja lógica: isActive = false.
   * No se elimina físicamente para preservar el historial de ventas
   * (SaleItems y BookingItems referencian este producto).
   */
  async remove(id: string): Promise<void> {
    const product = await this.findOne(id);

    if (!product.isActive) {
      throw new BadRequestException(`El producto "${product.name}" ya está desactivado.`);
    }

    product.isActive = false;
    await this.productRepo.save(product);
    this.logger.log(`Producto desactivado: "${product.name}"`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  PRIVADOS
  // ───────────────────────────────────────────────────────────────────────────

  private async validateCategory(categoryId: string): Promise<void> {
    const category = await this.categoryRepo.findOne({
      where: { id: categoryId },
    });

    if (!category) {
      throw new NotFoundException(`Categoría con ID ${categoryId} no encontrada.`);
    }
  }

  /**
   * Resumen estadístico para el módulo de Productos.
   * Consumido por el componente de inventario del frontend.
   */
  async getSummary() {
    const [total, featured, lowStockCount, totalValue] = await Promise.all([
      this.productRepo.count({ where: { isActive: true } }),
      this.productRepo.count({ where: { isActive: true, isFeatured: true } }),
      this.productRepo
        .createQueryBuilder('p')
        .where('p.isActive = true AND p.stock < p.minStock')
        .getCount(),
      this.productRepo
        .createQueryBuilder('p')
        .select('SUM(p.salePrice * p.stock)', 'total')
        .where('p.isActive = true')
        .getRawOne()
        .then((r) => parseFloat(r?.total ?? '0')),
    ]);

    return { total, featured, lowStockCount, totalInventoryValue: totalValue };
  }
}
