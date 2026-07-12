import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { Product } from './entities/product.entity';
import { UserRole } from '../users/entities/user.entity';

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

describe('ProductsController', () => {
  let controller: ProductsController;

  const productsService = {
    findAll: jest.fn(),
    findFeatured: jest.fn(),
    findLowStock: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: productsService }],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
    jest.clearAllMocks();
  });

  describe('costPrice según rol', () => {
    it('findAll: oculta costPrice para EMPLOYEE', async () => {
      productsService.findAll.mockResolvedValue([mockProduct(), mockProduct({ id: 'p2' })]);

      const result = await controller.findAll({}, UserRole.EMPLOYEE);

      expect(result).toHaveLength(2);
      result.forEach((p) => expect(p).not.toHaveProperty('costPrice'));
      expect(result[0]).toHaveProperty('salePrice', 1500);
    });

    it('findAll: conserva costPrice para ADMIN', async () => {
      productsService.findAll.mockResolvedValue([mockProduct()]);

      const result = await controller.findAll({}, UserRole.ADMIN);

      expect(result[0]).toHaveProperty('costPrice', 1000);
    });

    it('findFeatured: oculta costPrice para EMPLOYEE', async () => {
      productsService.findFeatured.mockResolvedValue([mockProduct({ isFeatured: true })]);

      const result = await controller.findFeatured(UserRole.EMPLOYEE);

      expect(result[0]).not.toHaveProperty('costPrice');
    });

    it('findFeatured: conserva costPrice para ADMIN', async () => {
      productsService.findFeatured.mockResolvedValue([mockProduct({ isFeatured: true })]);

      const result = await controller.findFeatured(UserRole.ADMIN);

      expect(result[0]).toHaveProperty('costPrice', 1000);
    });

    it('findLowStock: oculta costPrice para EMPLOYEE', async () => {
      productsService.findLowStock.mockResolvedValue([mockProduct({ stock: 1 })]);

      const result = await controller.findLowStock(UserRole.EMPLOYEE);

      expect(result[0]).not.toHaveProperty('costPrice');
    });

    it('findLowStock: conserva costPrice para ADMIN', async () => {
      productsService.findLowStock.mockResolvedValue([mockProduct({ stock: 1 })]);

      const result = await controller.findLowStock(UserRole.ADMIN);

      expect(result[0]).toHaveProperty('costPrice', 1000);
    });

    it('findOne: oculta costPrice para EMPLOYEE', async () => {
      productsService.findOne.mockResolvedValue(mockProduct());

      const result = await controller.findOne('product-uuid', UserRole.EMPLOYEE);

      expect(result).not.toHaveProperty('costPrice');
      expect(result).toHaveProperty('salePrice', 1500);
    });

    it('findOne: conserva costPrice para ADMIN', async () => {
      productsService.findOne.mockResolvedValue(mockProduct());

      const result = await controller.findOne('product-uuid', UserRole.ADMIN);

      expect(result).toHaveProperty('costPrice', 1000);
    });
  });
});
