import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProductsService } from './products.service';
import { Product } from './entities/product.entity';
import { ProductCategory } from './entities/product-category.entity';

const mockProduct = (overrides: Partial<Product> = {}): Product =>
  ({
    id: 'product-uuid',
    name: 'Pelota Babolat',
    categoryId: 'cat-uuid',
    costPrice: 1000,
    salePrice: 1500,
    stock: 20,
    minStock: 5,
    isFeatured: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Product;

const mockCategory = (): ProductCategory =>
  ({ id: 'cat-uuid', name: 'Pelotas', createdAt: new Date() }) as ProductCategory;

describe('ProductsService', () => {
  let service: ProductsService;

  const productRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const categoryRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockQb = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
    getCount: jest.fn(),
    select: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(ProductCategory), useValue: categoryRepo },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    jest.clearAllMocks();
    productRepo.createQueryBuilder.mockReturnValue(mockQb);
    mockQb.leftJoinAndSelect.mockReturnThis();
    mockQb.leftJoin.mockReturnThis();
    mockQb.where.mockReturnThis();
    mockQb.andWhere.mockReturnThis();
    mockQb.orderBy.mockReturnThis();
    mockQb.select.mockReturnThis();
  });

  describe('findAll', () => {
    it('retorna solo productos activos por defecto', async () => {
      productRepo.find.mockResolvedValue([mockProduct()]);
      await service.findAll({});
      expect(productRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
      );
    });

    it('filtra por stock bajo en memoria', async () => {
      productRepo.find.mockResolvedValue([
        mockProduct({ stock: 2, minStock: 5 }),
        mockProduct({ id: 'p2', stock: 10, minStock: 5 }),
      ]);
      const result = await service.findAll({ lowStock: true });
      expect(result).toHaveLength(1);
      expect(result[0].stock).toBe(2);
    });

    it('incluye productos inactivos si onlyActive es false', async () => {
      productRepo.find.mockResolvedValue([
        mockProduct(),
        mockProduct({ id: 'p2', isActive: false }),
      ]);
      await service.findAll({ onlyActive: false });
      expect(productRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.not.objectContaining({ isActive: true }) }),
      );
    });
  });

  describe('findFeatured', () => {
    it('retorna solo productos destacados y activos', async () => {
      productRepo.find.mockResolvedValue([mockProduct({ isFeatured: true })]);
      await service.findFeatured();
      expect(productRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isFeatured: true, isActive: true } }),
      );
    });
  });

  describe('findLowStock', () => {
    it('usa QueryBuilder para comparar stock con minStock', async () => {
      mockQb.getMany.mockResolvedValue([mockProduct({ stock: 1 })]);
      const result = await service.findLowStock();
      expect(result).toHaveLength(1);
      expect(productRepo.createQueryBuilder).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('retorna el producto si existe', async () => {
      productRepo.findOne.mockResolvedValue(mockProduct());
      const result = await service.findOne('product-uuid');
      expect(result.id).toBe('product-uuid');
    });

    it('lanza NotFoundException si no existe', async () => {
      productRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('crea un producto con categoría válida', async () => {
      categoryRepo.findOne.mockResolvedValue(mockCategory());
      const product = mockProduct();
      productRepo.create.mockReturnValue(product);
      productRepo.save.mockResolvedValue(product);
      productRepo.findOne.mockResolvedValue(product);

      const result = await service.create({
        name: 'Pelota Babolat',
        categoryId: 'cat-uuid',
        costPrice: 1000,
        salePrice: 1500,
        stock: 20,
      });

      expect(result.name).toBe('Pelota Babolat');
    });

    it('lanza NotFoundException si la categoría no existe', async () => {
      categoryRepo.findOne.mockResolvedValue(null);
      await expect(
        service.create({ name: 'X', categoryId: 'bad-cat', costPrice: 1, salePrice: 2, stock: 1 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('ajusta el stock y loguea la diferencia', async () => {
      const product = mockProduct({ stock: 10 });
      productRepo.findOne.mockResolvedValue(product);
      productRepo.update.mockResolvedValue({ affected: 1 });

      await service.update('product-uuid', { stock: 20 });
      expect(productRepo.update).toHaveBeenCalledWith(
        'product-uuid',
        expect.objectContaining({ stock: 20 }),
      );
    });

    it('lanza BadRequestException si el stock es negativo', async () => {
      productRepo.findOne.mockResolvedValue(mockProduct());
      await expect(service.update('product-uuid', { stock: -1 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('remove', () => {
    it('desactiva el producto (baja lógica)', async () => {
      productRepo.findOne.mockResolvedValue(mockProduct({ isActive: true }));
      productRepo.save.mockResolvedValue(mockProduct({ isActive: false }));

      await service.remove('product-uuid');
      expect(productRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
    });

    it('lanza BadRequestException si ya está desactivado', async () => {
      productRepo.findOne.mockResolvedValue(mockProduct({ isActive: false }));
      await expect(service.remove('product-uuid')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getSummary', () => {
    it('retorna estadísticas de inventario', async () => {
      productRepo.count.mockResolvedValueOnce(10).mockResolvedValueOnce(3);
      mockQb.getCount.mockResolvedValue(2);
      mockQb.getRawOne.mockResolvedValue({ total: '15000' });

      const result = await service.getSummary();
      expect(result.total).toBe(10);
      expect(result.featured).toBe(3);
      expect(result.lowStockCount).toBe(2);
      expect(result.totalInventoryValue).toBe(15000);
    });
  });
});
