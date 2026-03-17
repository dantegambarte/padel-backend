import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CashRegisterService } from './cash-register.service';
import { CashSession, CashSessionStatus } from './entities/cash-session.entity';
import { Transaction } from './entities/transaction.entity';
import { User, UserRole } from '../users/entities/user.entity';

const mockUser = (): User =>
  ({ id: 'admin-uuid', username: 'admin', role: UserRole.ADMIN } as User);

const mockSession = (overrides: Partial<CashSession> = {}): CashSession =>
  ({
    id: 'session-uuid',
    date: '2025-06-01',
    status: CashSessionStatus.OPEN,
    openedByUserId: 'admin-uuid',
    openedAt: new Date(),
    closedAt: null,
    cashCounted: null,
    difference: null,
    notes: '',
    ...overrides,
  }) as CashSession;

describe('CashRegisterService', () => {
  let service: CashRegisterService;

  const sessionRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const transactionRepo = {
    find: jest.fn(),
  };

  const dataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashRegisterService,
        { provide: getRepositoryToken(CashSession), useValue: sessionRepo },
        { provide: getRepositoryToken(Transaction), useValue: transactionRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<CashRegisterService>(CashRegisterService);
    jest.clearAllMocks();
  });

  describe('getCurrentSession', () => {
    it('retorna sesión vacía si no hay ninguna hoy', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      const result = await service.getCurrentSession();
      expect(result.session).toBeNull();
      expect(result.cashExpected).toBe(0);
      expect(result.isOpen).toBe(true);
    });

    it('retorna los totales calculados desde transactions', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession());
      dataSource.query
        .mockResolvedValueOnce([{ cash_expected: '15000', transfer_total: '5000' }]);
      dataSource.query
        .mockResolvedValueOnce([]);
      transactionRepo.find.mockResolvedValue([]);

      const result = await service.getCurrentSession();
      expect(result.cashExpected).toBe(15000);
      expect(result.transferTotal).toBe(5000);
      expect(result.dayTotal).toBe(20000);
    });

    it('retorna isOpen false si la sesión está cerrada', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession({ status: CashSessionStatus.CLOSED }));
      dataSource.query.mockResolvedValue([{ cash_expected: '0', transfer_total: '0' }]);
      transactionRepo.find.mockResolvedValue([]);

      const result = await service.getCurrentSession();
      expect(result.isOpen).toBe(false);
    });
  });

  describe('closeSession', () => {
    it('cierra la sesión y calcula la diferencia', async () => {
      const session = mockSession();
      sessionRepo.findOne.mockResolvedValue(session);
      dataSource.query.mockResolvedValue([{ cash_expected: '10000', transfer_total: '2000' }]);
      sessionRepo.save.mockResolvedValue({ ...session, status: CashSessionStatus.CLOSED });

      const result = await service.closeSession({ cashCounted: 10500 }, mockUser());

      expect(result.difference).toBe(500);
      expect(result.balances).toBe('surplus');
      expect(sessionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CashSessionStatus.CLOSED }),
      );
    });

    it('retorna "exact" cuando lo contado coincide con lo esperado', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession());
      dataSource.query.mockResolvedValue([{ cash_expected: '10000', transfer_total: '0' }]);
      sessionRepo.save.mockResolvedValue({});

      const result = await service.closeSession({ cashCounted: 10000 }, mockUser());
      expect(result.balances).toBe('exact');
    });

    it('retorna "shortage" cuando hay faltante', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession());
      dataSource.query.mockResolvedValue([{ cash_expected: '10000', transfer_total: '0' }]);
      sessionRepo.save.mockResolvedValue({});

      const result = await service.closeSession({ cashCounted: 9000 }, mockUser());
      expect(result.difference).toBe(-1000);
      expect(result.balances).toBe('shortage');
    });

    it('lanza NotFoundException si no hay sesión abierta', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      await expect(service.closeSession({ cashCounted: 0 }, mockUser())).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException si no hay caja abierta (ya fue cerrada)', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      await expect(service.closeSession({ cashCounted: 0 }, mockUser())).rejects.toThrow(NotFoundException);
    });
  });

  describe('getOrCreateActiveSession', () => {
    it('retorna la sesión abierta existente sin crear una nueva', async () => {
      const session = mockSession();
      const mockQr: any = {
        query: jest.fn().mockResolvedValue([]),
        manager: {
          findOne: jest.fn().mockResolvedValue(session),
          create: jest.fn(),
          save: jest.fn(),
        },
      };

      const result = await service.getOrCreateActiveSession(mockQr, 'admin-uuid');
      expect(result.id).toBe('session-uuid');
      expect(mockQr.manager.create).not.toHaveBeenCalled();
    });

    it('lanza ServiceUnavailableException si la jornada comercial ya fue cerrada', async () => {
      const mockQr: any = {
        query: jest.fn().mockResolvedValue([]),
        manager: {
          findOne: jest.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(mockSession({ status: CashSessionStatus.CLOSED })),
        },
      };

      await expect(
        service.getOrCreateActiveSession(mockQr, 'admin-uuid'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('crea una nueva sesión si no existe ninguna abierta ni cerrada hoy', async () => {
      const newSession = mockSession();
      const mockQr: any = {
        query: jest.fn().mockResolvedValue([]),
        manager: {
          findOne: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockReturnValue(newSession),
          save: jest.fn().mockResolvedValue(newSession),
        },
      };

      const result = await service.getOrCreateActiveSession(mockQr, 'admin-uuid');
      expect(mockQr.manager.create).toHaveBeenCalled();
      expect(result.id).toBe('session-uuid');
    });
  });
});
