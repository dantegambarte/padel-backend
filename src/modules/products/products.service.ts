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

  /** Retorna productos filtrados por categoría, nombre o stock bajo. */
  async findAll(query: QueryProductsDto): Promise<Product[]> {
    const where: any = {};

    if (query.onlyActive !== false) {
      where.isActive = true;
    }

    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }

    if (query.search) {
      where.name = ILike(`%${query.search}%`);
    }

    const products = await this.productRepo.find({
      where,
      relations: ['category'],
      order: { name: 'ASC' },
    });

    if (query.lowStock) {
      return products.filter((p) => p.stock < p.minStock);
    }

    return products;
  }

  /** Retorna los productos destacados activos para acceso rápido en el modal de agenda. */
  async findFeatured(): Promise<Product[]> {
    return this.productRepo.find({
      where: { isFeatured: true, isActive: true },
      relations: ['category'],
      order: { name: 'ASC' },
    });
  }

  /** Retorna los productos con stock por debajo del mínimo configurado. */
  async findLowStock(): Promise<Product[]> {
    return this.productRepo
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .where('product.isActive = true')
      .andWhere('product.stock < product.minStock')
      .orderBy('product.stock', 'ASC')
      .getMany();
  }

  /** Retorna un producto por ID con su categoría. */
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

  /** Retorna todas las categorías de productos. */
  findAllCategories(): Promise<ProductCategory[]> {
    return this.categoryRepo.find({ order: { name: 'ASC' } });
  }

  /**
   * Crea una categoría si no existe (idempotente por nombre, case-insensitive).
   * Usado cuando el usuario tipea una nueva categoría en el formulario de producto.
   */
  async createCategory(name: string): Promise<ProductCategory> {
    const trimmed = name.trim();
    const existing = await this.categoryRepo.findOne({
      where: { name: ILike(trimmed) },
    });
    if (existing) return existing;

    const category = this.categoryRepo.create({ name: trimmed });
    const saved = await this.categoryRepo.save(category);
    this.logger.log(`Categoría creada: "${saved.name}"`);
    return saved;
  }

  /** Crea un producto validando que la categoría exista si se especifica. */
  async create(dto: CreateProductDto): Promise<Product> {
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

  /** Actualiza un producto. Los ajustes de stock solo se permiten desde este endpoint. */
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

  /** Desactiva un producto (baja lógica) para preservar el historial de ventas. */
  async remove(id: string): Promise<void> {
    const product = await this.findOne(id);

    if (!product.isActive) {
      throw new BadRequestException(`El producto "${product.name}" ya está desactivado.`);
    }

    product.isActive = false;
    await this.productRepo.save(product);
    this.logger.log(`Producto desactivado: "${product.name}"`);
  }

  /** Verifica que una categoría exista por ID. */
  private async validateCategory(categoryId: string): Promise<void> {
    const category = await this.categoryRepo.findOne({
      where: { id: categoryId },
    });

    if (!category) {
      throw new NotFoundException(`Categoría con ID ${categoryId} no encontrada.`);
    }
  }

  /** Retorna estadísticas de inventario: total, destacados, bajo stock y valor total. */
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
