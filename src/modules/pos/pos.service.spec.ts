import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PosService } from './pos.service';
import { Sale } from './entities/sale.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { CashRegisterService } from '../cash-register/cash-register.service';

const mockUser = (): User =>
  ({ id: 'emp-uuid', username: 'empleado', role: UserRole.EMPLOYEE }) as User;

const mockSale = (overrides: Partial<Sale> = {}): Sale =>
  ({
    id: 'sale-uuid',
    total: 3000,
    amountCash: 3000,
    amountTransfer: 0,
    cashSessionId: 'session-uuid',
    createdByUserId: 'emp-uuid',
    idempotencyKey: null,
    items: [],
    createdAt: new Date(),
    ...overrides,
  }) as Sale;

describe('PosService', () => {
  let service: PosService;

  const mockQb = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };

  const saleRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    findOne: jest.fn(),
  };

  const mockManager = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    decrement: jest.fn(),
  };

  const mockQueryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    manager: mockManager,
  };

  const dataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  const cashRegisterService = {
    getActiveSessionOrFail: jest.fn().mockResolvedValue({ id: 'session-uuid' }),
    registerTransaction: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PosService,
        { provide: getRepositoryToken(Sale), useValue: saleRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: CashRegisterService, useValue: cashRegisterService },
      ],
    }).compile();

    service = module.get<PosService>(PosService);
    jest.clearAllMocks();

    dataSource.createQueryRunner.mockReturnValue(mockQueryRunner);
    mockQueryRunner.connect.mockResolvedValue(undefined);
    mockQueryRunner.startTransaction.mockResolvedValue(undefined);
    mockQueryRunner.commitTransaction.mockResolvedValue(undefined);
    mockQueryRunner.rollbackTransaction.mockResolvedValue(undefined);
    mockQueryRunner.release.mockResolvedValue(undefined);
    saleRepo.createQueryBuilder.mockReturnValue(mockQb);
    mockQb.leftJoinAndSelect.mockReturnThis();
    mockQb.where.mockReturnThis();
    mockQb.orderBy.mockReturnThis();
    cashRegisterService.getActiveSessionOrFail.mockResolvedValue({ id: 'session-uuid' });
    cashRegisterService.registerTransaction.mockResolvedValue({});
  });

  describe('findByDate', () => {
    it('retorna las ventas del día', async () => {
      mockQb.getMany.mockResolvedValue([mockSale()]);
      const result = await service.findByDate('2025-06-01');
      expect(result).toHaveLength(1);
    });
  });

  describe('findOneWithDetails', () => {
    it('retorna la venta con detalles', async () => {
      saleRepo.findOne.mockResolvedValue(mockSale());
      const result = await service.findOneWithDetails('sale-uuid');
      expect(result.id).toBe('sale-uuid');
    });

    it('lanza NotFoundException si no existe', async () => {
      saleRepo.findOne.mockResolvedValue(null);
      await expect(service.findOneWithDetails('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create - idempotencia', () => {
    it('retorna la venta existente si la idempotency key ya fue usada', async () => {
      const existingSale = mockSale({ idempotencyKey: 'key-123' });
      saleRepo.findOne.mockResolvedValueOnce(existingSale);

      const result = await service.create(
        { items: [{ productId: 'p1', quantity: 1 }], amountCash: 1500 },
        mockUser(),
        'key-123',
      );

      expect(result.id).toBe('sale-uuid');
      expect(mockQueryRunner.startTransaction).not.toHaveBeenCalled();
    });
  });

  describe('create - pago insuficiente', () => {
    it('lanza BadRequestException si el total cobrado no cubre el total', async () => {
      saleRepo.findOne.mockResolvedValueOnce(null);

      const product = { id: 'p1', name: 'Pelota', salePrice: 1500, stock: 10, isActive: true };
      mockManager.findOne.mockResolvedValue(product);

      await expect(
        service.create(
          { items: [{ productId: 'p1', quantity: 2 }], amountCash: 100, amountTransfer: 0 },
          mockUser(),
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create - producto duplicado en carrito', () => {
    it('lanza BadRequestException si el mismo producto aparece dos veces', async () => {
      saleRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.create(
          {
            items: [
              { productId: 'p1', quantity: 1 },
              { productId: 'p1', quantity: 2 },
            ],
            amountCash: 9999,
          },
          mockUser(),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create - stock insuficiente', () => {
    it('lanza ConflictException si el stock es menor al solicitado', async () => {
      saleRepo.findOne.mockResolvedValueOnce(null);

      const product = { id: 'p1', name: 'Pelota', salePrice: 1500, stock: 1, isActive: true };
      mockManager.findOne.mockResolvedValue(product);

      await expect(
        service.create(
          { items: [{ productId: 'p1', quantity: 5 }], amountCash: 99999 },
          mockUser(),
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('create - producto no encontrado', () => {
    it('lanza NotFoundException si el producto no existe', async () => {
      saleRepo.findOne.mockResolvedValueOnce(null);
      mockManager.findOne.mockResolvedValue(null);

      await expect(
        service.create(
          { items: [{ productId: 'missing', quantity: 1 }], amountCash: 9999 },
          mockUser(),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
