import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PosService } from './pos.service';
import { Sale, SaleStatus } from './entities/sale.entity';
import { Product } from '../products/entities/product.entity';
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
    status: SaleStatus.PAID,
    cashSessionId: 'session-uuid',
    createdByUserId: 'emp-uuid',
    customerName: null,
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
    find: jest.fn(),
  };

  const mockManager = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    decrement: jest.fn(),
    increment: jest.fn(),
    update: jest.fn(),
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
    // clearAllMocks no vacía la cola de mockResolvedValueOnce: si un test anterior
    // encoló un valor y nunca llegó a consumirlo (p. ej. porque el service tiró
    // antes), ese valor queda pendiente y contamina el próximo test que sí llame
    // al mock. Reset explícito para evitar falsos negativos entre tests.
    saleRepo.findOne.mockReset();

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

  describe('create - cuenta abierta (status "open")', () => {
    const product = { id: 'p1', name: 'Agua', salePrice: 300, stock: 10, isActive: true };

    beforeEach(() => {
      mockManager.findOne.mockResolvedValue(product);
      mockManager.create.mockImplementation((_entity, data) => data);
      mockManager.save.mockImplementation((_entity, data) =>
        Promise.resolve(Array.isArray(data) ? data : { id: 'sale-uuid', ...data }),
      );
      saleRepo.findOne.mockResolvedValue(
        mockSale({ status: SaleStatus.OPEN, customerName: 'Lu', amountCash: 0, amountTransfer: 0 }),
      );
    });

    it('crea la venta con status open, monto en 0 y descuenta stock sin registrar caja', async () => {
      const result = await service.create(
        {
          status: SaleStatus.OPEN,
          customerName: 'Lu',
          items: [{ productId: 'p1', quantity: 1 }],
        } as any,
        mockUser(),
      );

      expect(result.status).toBe(SaleStatus.OPEN);
      expect(mockManager.decrement).toHaveBeenCalledWith(
        Product,
        { id: 'p1' },
        'stock',
        1,
      );
      expect(cashRegisterService.registerTransaction).not.toHaveBeenCalled();
    });

    it('no exige que el pago cubra el total (se paga después con /pay)', async () => {
      await expect(
        service.create(
          {
            status: SaleStatus.OPEN,
            customerName: 'Lu',
            items: [{ productId: 'p1', quantity: 5 }],
          } as any,
          mockUser(),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('findOpenSales', () => {
    it('retorna las ventas con status open', async () => {
      saleRepo.find.mockResolvedValue([mockSale({ status: SaleStatus.OPEN })]);

      const result = await service.findOpenSales();

      expect(result).toHaveLength(1);
      expect(saleRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: SaleStatus.OPEN } }),
      );
    });
  });

  describe('addItems', () => {
    const openSale = mockSale({ id: 'sale-uuid', status: SaleStatus.OPEN, total: 300 });
    const product = { id: 'p2', name: 'Barrita', salePrice: 350, stock: 10, isActive: true };

    it('agrega items, descuenta stock e incrementa el total', async () => {
      mockManager.findOne.mockImplementation((entity: any) => {
        if (entity === Sale) return Promise.resolve(openSale);
        if (entity === Product) return Promise.resolve(product);
        return Promise.resolve(null);
      });
      mockManager.create.mockImplementation((_entity, data) => data);
      mockManager.save.mockResolvedValue([]);
      saleRepo.findOne.mockResolvedValue(mockSale({ status: SaleStatus.OPEN, total: 650 }));

      const result = await service.addItems('sale-uuid', {
        items: [{ productId: 'p2', quantity: 1 }],
      } as any);

      expect(mockManager.decrement).toHaveBeenCalledWith(Product, { id: 'p2' }, 'stock', 1);
      expect(mockManager.increment).toHaveBeenCalledWith(
        Sale,
        { id: 'sale-uuid' },
        'total',
        350,
      );
      expect(result).toBeDefined();
    });

    it('lanza NotFoundException si la cuenta no existe', async () => {
      mockManager.findOne.mockResolvedValueOnce(null);

      await expect(
        service.addItems('missing', { items: [{ productId: 'p2', quantity: 1 }] } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException si la venta no está abierta (ya está paid)', async () => {
      mockManager.findOne.mockResolvedValueOnce(mockSale({ status: SaleStatus.PAID }));

      await expect(
        service.addItems('sale-uuid', { items: [{ productId: 'p2', quantity: 1 }] } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('pay', () => {
    it('cobra la cuenta, marca status paid y registra la transacción en caja', async () => {
      const openSale = mockSale({ id: 'sale-uuid', status: SaleStatus.OPEN, total: 1000 });
      mockManager.findOne.mockResolvedValueOnce(openSale);
      saleRepo.findOne.mockResolvedValue(
        mockSale({ status: SaleStatus.PAID, amountCash: 1000, total: 1000 }),
      );

      const result = await service.pay(
        'sale-uuid',
        { amountCash: 1000, amountTransfer: 0 },
        mockUser(),
      );

      expect(mockManager.update).toHaveBeenCalledWith(
        Sale,
        'sale-uuid',
        expect.objectContaining({ status: SaleStatus.PAID, amountCash: 1000 }),
      );
      expect(cashRegisterService.registerTransaction).toHaveBeenCalledWith(
        mockQueryRunner,
        expect.objectContaining({ referenceId: 'sale-uuid', amountCash: 1000 }),
      );
      expect(result.status).toBe(SaleStatus.PAID);
    });

    it('lanza NotFoundException si la cuenta no existe', async () => {
      mockManager.findOne.mockResolvedValueOnce(null);

      await expect(
        service.pay('missing', { amountCash: 100 }, mockUser()),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException si la venta ya fue pagada', async () => {
      mockManager.findOne.mockResolvedValueOnce(mockSale({ status: SaleStatus.PAID }));

      await expect(
        service.pay('sale-uuid', { amountCash: 100 }, mockUser()),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si el pago no cubre el total', async () => {
      const openSale = mockSale({ id: 'sale-uuid', status: SaleStatus.OPEN, total: 1000 });
      mockManager.findOne.mockResolvedValueOnce(openSale);

      await expect(
        service.pay('sale-uuid', { amountCash: 100 }, mockUser()),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
