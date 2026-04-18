import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';

import { InternalConsumptionService } from './internal-consumption.service';
import {
  InternalConsumption,
  InternalConsumptionStatus,
  InternalConsumptionConsumerType,
} from './entities/internal-consumption.entity';
import { ProductsService } from '../products/products.service';
import { CashRegisterService } from '../cash-register/cash-register.service';
import { CreateInternalConsumptionDto } from './dto/create-internal-consumption.dto';
import { SettleTeacherDebtDto, PaymentMethod } from './dto/settle-teacher-debt.dto';
import { Product } from '../products/entities/product.entity';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ADMIN_USER_ID = 'admin-uuid-001';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-uuid-001',
    name: 'Gatorade',
    costPrice: 500,
    salePrice: 800,
    stock: 10,
    minStock: 2,
    isFeatured: false,
    isActive: true,
    icon: 'inventory_2',
    categoryId: null,
    category: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    bookingItems: [],
    saleItems: [],
    ...overrides,
  } as unknown as Product;
}

function makeConsumption(overrides: Partial<InternalConsumption> = {}): InternalConsumption {
  return {
    id: 'ic-uuid-001',
    productId: 'product-uuid-001',
    product: makeProduct(),
    quantity: 2,
    consumerType: InternalConsumptionConsumerType.TEACHER,
    userId: null,
    user: null,
    teacherId: 'teacher-uuid-001',
    teacher: null,
    status: InternalConsumptionStatus.PENDING_PAYMENT,
    notes: null,
    unitCostPrice: 500,
    date: '2026-04-15',
    createdByUserId: ADMIN_USER_ID,
    createdByUser: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as InternalConsumption;
}

// ─── QueryRunner mock factory ──────────────────────────────────────────────────

function makeQueryRunner(savedEntity?: InternalConsumption) {
  const decrementFn = jest.fn().mockResolvedValue(undefined);
  const createFn = jest.fn().mockReturnValue(savedEntity ?? makeConsumption());
  const saveFn = jest.fn().mockResolvedValue(savedEntity ?? makeConsumption());
  const updateFn = jest.fn().mockResolvedValue(undefined);
  const findOneFn = jest.fn().mockResolvedValue(null);
  const commitFn = jest.fn().mockResolvedValue(undefined);
  const rollbackFn = jest.fn().mockResolvedValue(undefined);
  const releaseFn = jest.fn().mockResolvedValue(undefined);
  const connectFn = jest.fn().mockResolvedValue(undefined);
  const startTransactionFn = jest.fn().mockResolvedValue(undefined);
  const queryFn = jest.fn().mockResolvedValue(undefined);

  const qr = {
    connect: connectFn,
    startTransaction: startTransactionFn,
    query: queryFn,
    manager: {
      decrement: decrementFn,
      create: createFn,
      save: saveFn,
      update: updateFn,
      findOne: findOneFn,
    },
    commitTransaction: commitFn,
    rollbackTransaction: rollbackFn,
    release: releaseFn,
  };

  return { qr, decrementFn, createFn, saveFn, updateFn, commitFn, rollbackFn, releaseFn };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('InternalConsumptionService', () => {
  let service: InternalConsumptionService;
  let repo: jest.Mocked<Repository<InternalConsumption>>;
  let productsService: jest.Mocked<ProductsService>;
  let cashRegisterService: jest.Mocked<CashRegisterService>;
  let dataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    const mockRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      findBy: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const mockProductsService = {
      findOne: jest.fn(),
    };

    const mockCashRegisterService = {
      getActiveSessionOrFail: jest.fn(),
    };

    const mockDataSource = {
      createQueryRunner: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InternalConsumptionService,
        { provide: getRepositoryToken(InternalConsumption), useValue: mockRepo },
        { provide: ProductsService, useValue: mockProductsService },
        { provide: CashRegisterService, useValue: mockCashRegisterService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get(InternalConsumptionService);
    repo = module.get(getRepositoryToken(InternalConsumption));
    productsService = module.get(ProductsService);
    cashRegisterService = module.get(CashRegisterService);
    dataSource = module.get(DataSource);
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto: CreateInternalConsumptionDto = {
      productId: 'product-uuid-001',
      quantity: 2,
      consumerType: InternalConsumptionConsumerType.TEACHER,
      teacherId: 'teacher-uuid-001',
      date: '2026-04-15',
    };

    it('creates consumption for teacher → status pending_payment', async () => {
      const product = makeProduct({ stock: 10 });
      const saved = makeConsumption();
      const { qr, decrementFn, commitFn } = makeQueryRunner(saved);

      productsService.findOne.mockResolvedValue(product);
      dataSource.createQueryRunner.mockReturnValue(qr as any);
      repo.findOne.mockResolvedValue(saved);

      const result = await service.create(dto, ADMIN_USER_ID);

      expect(productsService.findOne).toHaveBeenCalledWith(dto.productId);
      expect(decrementFn).toHaveBeenCalledWith(
        Product,
        { id: dto.productId },
        'stock',
        dto.quantity,
      );
      expect(commitFn).toHaveBeenCalled();
      expect(result.status).toBe(InternalConsumptionStatus.PENDING_PAYMENT);
    });

    it('creates consumption for staff → status staff_consumption', async () => {
      const staffDto: CreateInternalConsumptionDto = {
        productId: 'product-uuid-001',
        quantity: 1,
        consumerType: InternalConsumptionConsumerType.STAFF,
        userId: 'user-uuid-001',
        date: '2026-04-15',
      };
      const product = makeProduct({ stock: 5 });
      const saved = makeConsumption({
        consumerType: InternalConsumptionConsumerType.STAFF,
        status: InternalConsumptionStatus.STAFF_CONSUMPTION,
        userId: 'user-uuid-001',
        teacherId: null,
      });
      const { qr } = makeQueryRunner(saved);

      productsService.findOne.mockResolvedValue(product);
      dataSource.createQueryRunner.mockReturnValue(qr as any);
      repo.findOne.mockResolvedValue(saved);

      const result = await service.create(staffDto, ADMIN_USER_ID);

      expect(result.status).toBe(InternalConsumptionStatus.STAFF_CONSUMPTION);
    });

    it('throws BadRequestException when stock insufficient', async () => {
      productsService.findOne.mockResolvedValue(makeProduct({ stock: 1 }));

      await expect(service.create({ ...dto, quantity: 5 }, ADMIN_USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rolls back transaction on error', async () => {
      const product = makeProduct({ stock: 10 });
      const { qr, rollbackFn, decrementFn } = makeQueryRunner();

      productsService.findOne.mockResolvedValue(product);
      dataSource.createQueryRunner.mockReturnValue(qr as any);
      decrementFn.mockRejectedValue(new Error('DB error'));

      await expect(service.create(dto, ADMIN_USER_ID)).rejects.toThrow('DB error');
      expect(rollbackFn).toHaveBeenCalled();
    });

    it('always releases query runner', async () => {
      const product = makeProduct({ stock: 10 });
      const { qr, releaseFn, decrementFn } = makeQueryRunner();

      productsService.findOne.mockResolvedValue(product);
      dataSource.createQueryRunner.mockReturnValue(qr as any);
      decrementFn.mockRejectedValue(new Error('DB error'));

      await expect(service.create(dto, ADMIN_USER_ID)).rejects.toThrow();
      expect(releaseFn).toHaveBeenCalled();
    });
  });

  // ── findAll ──────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns all consumptions when no filters', async () => {
      const records = [makeConsumption()];
      repo.find.mockResolvedValue(records);

      const result = await service.findAll({});

      expect(repo.find).toHaveBeenCalled();
      expect(result).toEqual(records);
    });

    it('applies status filter', async () => {
      repo.find.mockResolvedValue([]);

      await service.findAll({ status: InternalConsumptionStatus.PENDING_PAYMENT });

      const callArgs = repo.find.mock.calls[0][0] as any;
      expect(callArgs.where.status).toBe(InternalConsumptionStatus.PENDING_PAYMENT);
    });

    it('applies teacherId filter', async () => {
      repo.find.mockResolvedValue([]);

      await service.findAll({ teacherId: 'teacher-uuid-001' });

      const callArgs = repo.find.mock.calls[0][0] as any;
      expect(callArgs.where.teacherId).toBe('teacher-uuid-001');
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns record when found', async () => {
      const record = makeConsumption();
      repo.findOne.mockResolvedValue(record);

      const result = await service.findOne('ic-uuid-001');

      expect(result).toEqual(record);
    });

    it('throws NotFoundException when not found', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ── settleTeacherDebt ────────────────────────────────────────────────────────

  describe('settleTeacherDebt', () => {
    const dto: SettleTeacherDebtDto = {
      teacherId: 'teacher-uuid-001',
      paymentMethod: PaymentMethod.CASH,
    };
    const fakeSession = { id: 'session-uuid-001' };

    beforeEach(() => {
      const { qr } = makeQueryRunner();
      dataSource.createQueryRunner.mockReturnValue(qr as any);
      cashRegisterService.getActiveSessionOrFail.mockResolvedValue(fakeSession as any);
    });

    it('settles all pending records for teacher', async () => {
      const pending = [makeConsumption(), makeConsumption({ id: 'ic-uuid-002' })];
      repo.find.mockResolvedValue(pending);
      repo.findBy.mockResolvedValue(
        pending.map((c) => ({ ...c, status: InternalConsumptionStatus.PAID })) as any,
      );

      const result = await service.settleTeacherDebt(dto, ADMIN_USER_ID);

      expect(cashRegisterService.getActiveSessionOrFail).toHaveBeenCalled();
      expect(result[0].status).toBe(InternalConsumptionStatus.PAID);
    });

    it('settles only specific IDs when consumptionIds provided', async () => {
      const pending = [makeConsumption(), makeConsumption({ id: 'ic-uuid-002' })];
      repo.find.mockResolvedValue(pending);
      repo.findBy.mockResolvedValue([
        { ...pending[0], status: InternalConsumptionStatus.PAID },
      ] as any);

      const result = await service.settleTeacherDebt(
        { ...dto, consumptionIds: ['ic-uuid-001'] },
        ADMIN_USER_ID,
      );

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(InternalConsumptionStatus.PAID);
    });

    it('throws NotFoundException when no pending records', async () => {
      repo.find.mockResolvedValue([]);

      await expect(service.settleTeacherDebt(dto, ADMIN_USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when consumptionIds not matching pending', async () => {
      const pending = [makeConsumption()];
      repo.find.mockResolvedValue(pending);

      await expect(
        service.settleTeacherDebt({ ...dto, consumptionIds: ['other-uuid'] }, ADMIN_USER_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
