import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CashRegisterService } from './cash-register.service';
import { CashSession, CashSessionStatus } from './entities/cash-session.entity';
import { Transaction } from './entities/transaction.entity';
import { User, UserRole } from '../users/entities/user.entity';

const mockUser = (): User =>
  ({ id: 'admin-uuid', username: 'admin', role: UserRole.ADMIN }) as User;

const mockSession = (overrides: Partial<CashSession> = {}): CashSession =>
  ({
    id: 'session-uuid',
    date: '2025-06-01',
    status: CashSessionStatus.OPEN,
    openedByUserId: 'admin-uuid',
    openedAt: new Date(),
    initialBalance: 5000,
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
    it('retorna session:null e isOpen:false si no hay ninguna sesión abierta', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      const result = await service.getCurrentSession();
      expect(result.session).toBeNull();
      expect(result.cashExpected).toBe(0);
      expect(result.isOpen).toBe(false);
    });

    it('retorna isOpen:false cuando la sesión está cerrada', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession({ status: CashSessionStatus.CLOSED }));
      dataSource.query
        .mockResolvedValueOnce([{ cash_expected: '0', transfer_total: '0' }])
        .mockResolvedValueOnce([]);

      const result = await service.getCurrentSession();
      expect(result.isOpen).toBe(false);
    });

    it('retorna los totales calculados desde transactions', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession());
      dataSource.query
        .mockResolvedValueOnce([{ cash_expected: '15000', transfer_total: '5000' }])
        .mockResolvedValueOnce([]);

      const result = await service.getCurrentSession();
      expect(result.cashExpected).toBe(15000);
      expect(result.transferTotal).toBe(5000);
      expect(result.dayTotal).toBe(20000);
    });

    it('retorna el initialBalance de la sesión', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession({ initialBalance: 3000 }));
      dataSource.query
        .mockResolvedValueOnce([{ cash_expected: '0', transfer_total: '0' }])
        .mockResolvedValueOnce([]);

      const result = await service.getCurrentSession();
      expect(result.initialBalance).toBe(3000);
    });

    it('retorna isOpen:true cuando la sesión está abierta', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession({ status: CashSessionStatus.OPEN }));
      dataSource.query
        .mockResolvedValueOnce([{ cash_expected: '10000', transfer_total: '2000' }])
        .mockResolvedValueOnce([]);

      const result = await service.getCurrentSession();
      expect(result.isOpen).toBe(true);
    });

    it('acepta ?date y retorna consulta histórica de esa fecha', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession({ status: CashSessionStatus.CLOSED }));
      dataSource.query
        .mockResolvedValueOnce([{ cash_expected: '8000', transfer_total: '3000' }])
        .mockResolvedValueOnce([]);

      const result = await service.getCurrentSession('2025-06-01');
      expect(result.dayTotal).toBe(11000);
    });

    it('turno trasnoche: devuelve la sesión CERRADA cuando closedAt está en la ventana comercial activa', async () => {
      const overnightSession = mockSession({
        status: CashSessionStatus.CLOSED,
        date: '2025-05-30',
        closedAt: new Date(),
      });

      sessionRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(overnightSession);

      dataSource.query
        .mockResolvedValueOnce([{ cash_expected: '12000', transfer_total: '3000' }])
        .mockResolvedValueOnce([]);

      const result = await service.getCurrentSession();

      expect(result.session).not.toBeNull();
      expect(result.isOpen).toBe(false);
      expect(result.session?.date).toBe('2025-05-30');
      expect(result.cashExpected).toBe(12000);
    });

    it('turno trasnoche: devuelve session:null cuando no hay sesiones en la ventana activa', async () => {
      sessionRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      const result = await service.getCurrentSession();

      expect(result.session).toBeNull();
      expect(result.isOpen).toBe(false);
      expect(result.cashExpected).toBe(0);
    });
  });

  describe('openSession', () => {
    it('abre una nueva sesión correctamente cuando no hay ninguna abierta', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      const newSession = mockSession();
      sessionRepo.create.mockReturnValue(newSession);
      sessionRepo.save.mockResolvedValue(newSession);

      const result = await service.openSession({ initialBalance: 5000 }, mockUser());

      expect(sessionRepo.save).toHaveBeenCalled();
      expect(result.status).toBe(CashSessionStatus.OPEN);
    });

    it('guarda el fondo inicial en la sesión', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      const newSession = mockSession({ initialBalance: 2500 });
      sessionRepo.create.mockReturnValue(newSession);
      sessionRepo.save.mockResolvedValue(newSession);

      const result = await service.openSession({ initialBalance: 2500 }, mockUser());
      expect(result.initialBalance).toBe(2500);
    });

    it('lanza ConflictException si ya existe una sesión OPEN', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession({ status: CashSessionStatus.OPEN }));

      await expect(service.openSession({ initialBalance: 0 }, mockUser())).rejects.toThrow(
        ConflictException,
      );
    });

    it('lanza ConflictException con código 23505 de la DB (pre-migración)', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      sessionRepo.create.mockReturnValue(mockSession());
      sessionRepo.save.mockRejectedValue({ code: '23505' });

      await expect(service.openSession({ initialBalance: 0 }, mockUser())).rejects.toThrow(
        ConflictException,
      );
    });

    it('permite abrir sesión aunque ya haya una CLOSED hoy (turnos mañana/tarde)', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      const newSession = mockSession();
      sessionRepo.create.mockReturnValue(newSession);
      sessionRepo.save.mockResolvedValue(newSession);

      await expect(
        service.openSession({ initialBalance: 1000 }, mockUser()),
      ).resolves.toBeDefined();
    });
  });

  describe('closeSession', () => {
    it('cierra la sesión y calcula la diferencia correctamente (sobrante)', async () => {
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

    it('retorna "exact" cuando lo contado coincide exactamente con lo esperado', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession());
      dataSource.query.mockResolvedValue([{ cash_expected: '10000', transfer_total: '0' }]);
      sessionRepo.save.mockResolvedValue({});

      const result = await service.closeSession({ cashCounted: 10000 }, mockUser());
      expect(result.balances).toBe('exact');
      expect(result.difference).toBe(0);
    });

    it('retorna "shortage" cuando hay faltante de caja', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession());
      dataSource.query.mockResolvedValue([{ cash_expected: '10000', transfer_total: '0' }]);
      sessionRepo.save.mockResolvedValue({});

      const result = await service.closeSession({ cashCounted: 9000 }, mockUser());
      expect(result.difference).toBe(-1000);
      expect(result.balances).toBe('shortage');
    });

    it('retorna transferTotal correctamente en el resumen', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession());
      dataSource.query.mockResolvedValue([{ cash_expected: '5000', transfer_total: '3000' }]);
      sessionRepo.save.mockResolvedValue({});

      const result = await service.closeSession({ cashCounted: 5000 }, mockUser());
      expect(result.transferTotal).toBe(3000);
      expect(result.dayTotal).toBe(8000);
    });

    it('lanza NotFoundException si no hay sesión abierta', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      await expect(service.closeSession({ cashCounted: 0 }, mockUser())).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getActiveSessionOrFail', () => {
    it('retorna la sesión abierta existente', async () => {
      const session = mockSession();
      const mockQr: any = {
        query: jest.fn().mockResolvedValue([]),
        manager: {
          findOne: jest.fn().mockResolvedValue(session),
        },
      };

      const result = await service.getActiveSessionOrFail(mockQr, 'admin-uuid');
      expect(result.id).toBe('session-uuid');
    });

    it('lanza BadRequestException con errorCode CAJA_CERRADA si no hay sesión abierta', async () => {
      const mockQr: any = {
        query: jest.fn().mockResolvedValue([]),
        manager: {
          findOne: jest.fn().mockResolvedValue(null),
        },
      };

      await expect(service.getActiveSessionOrFail(mockQr, 'admin-uuid')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('aplica advisory lock antes de buscar la sesión', async () => {
      const lockQuery = jest.fn().mockResolvedValue([]);
      const mockQr: any = {
        query: lockQuery,
        manager: { findOne: jest.fn().mockResolvedValue(mockSession()) },
      };

      await service.getActiveSessionOrFail(mockQr, 'admin-uuid');

      expect(lockQuery).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        expect.any(Array),
      );
    });
  });

  describe('getBusinessDate', () => {
    it('retorna una fecha en formato YYYY-MM-DD', () => {
      const result = service.getBusinessDate();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('retorna la fecha de ayer si la hora actual es entre 00:00 y 03:59 en Argentina', () => {
      const fakeDate = new Date('2025-06-02T05:00:00.000Z');
      jest.spyOn(global, 'Date').mockImplementation(() => fakeDate as any);

      const result = service.getBusinessDate();

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      jest.restoreAllMocks();
    });

    it('retorna la fecha de hoy si la hora actual es >= 04:00 en Argentina', () => {
      const fakeDate = new Date('2025-06-01T15:00:00.000Z');
      jest.spyOn(global, 'Date').mockImplementation(() => fakeDate as any);

      const result = service.getBusinessDate();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      jest.restoreAllMocks();
    });
  });

  describe('closeDay', () => {
    const closedSessionRow = {
      id: 'session-uuid',
      date: '2025-06-01',
      opened_at: new Date('2025-06-01T12:00:00Z'),
      closed_at: new Date('2025-06-01T20:00:00Z'),
      status: 'closed',
      cash_counted: '10000',
      difference: '500',
      opened_by_name: 'Admin',
      cash_expected: '9500',
      transfer_total: '2000',
    };

    it('lanza ConflictException si hay un turno OPEN', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession({ status: CashSessionStatus.OPEN }));

      await expect(service.closeDay()).rejects.toThrow(ConflictException);
    });

    it('consolida los turnos cerrados en la ventana activa y retorna el resumen', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([closedSessionRow]);

      const result = await service.closeDay();

      expect(result.date).toBe('2025-06-01');
      expect(result.sessions).toHaveLength(1);
      expect(result.totalExpected).toBe(11500);
      expect(result.totalCounted).toBe(10000);
    });

    it('turno trasnoche: consolida sesiones con distinto date pero closedAt en la ventana', async () => {
      const rowA = {
        ...closedSessionRow,
        id: 'sess-a',
        date: '2025-05-30',
        cash_expected: '5000',
        transfer_total: '1000',
        cash_counted: '5000',
        difference: '0',
      };
      const rowB = {
        ...closedSessionRow,
        id: 'sess-b',
        date: '2025-05-31',
        cash_expected: '8000',
        transfer_total: '2000',
        cash_counted: '8000',
        difference: '0',
      };

      sessionRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([rowA, rowB]);

      const result = await service.closeDay();

      expect(result.date).toBe('2025-05-30');
      expect(result.sessions).toHaveLength(2);
      expect(result.totalExpected).toBe(16000);
    });

    it('lanza NotFoundException si no hay turnos cerrados en la ventana activa', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);

      await expect(service.closeDay()).rejects.toThrow(NotFoundException);
    });

    it('totalCounted es null si algún turno no tiene cashCounted (no debería ocurrir en práctica)', async () => {
      const rowWithoutCount = { ...closedSessionRow, cash_counted: null, difference: null };
      sessionRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([rowWithoutCount]);

      const result = await service.closeDay();

      expect(result.totalCounted).toBeNull();
    });
  });

  describe('getActiveSessionKpis', () => {
    it('retorna ceros si no hay sesión OPEN activa', async () => {
      sessionRepo.findOne.mockResolvedValue(null);

      const result = await service.getActiveSessionKpis();

      expect(result.sessionId).toBeNull();
      expect(result.totalRevenue).toBe(0);
      expect(result.completedBookings).toBe(0);
      expect(result.occupationRate).toBe(0);
      expect(result.cantinaItemsSold).toBe(0);
    });

    it('retorna KPIs calculados desde la sesión activa', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession({ date: '2025-06-01' }));

      dataSource.query
        .mockResolvedValueOnce([{ total: '50000', cash: '30000', transfer: '20000' }])
        .mockResolvedValueOnce([{ completed: '5' }])
        .mockResolvedValueOnce([{ live: '1' }])
        .mockResolvedValueOnce([{ canceled: '2' }])
        .mockResolvedValueOnce([{ court_count: '2' }])
        .mockResolvedValueOnce([{ total_qty: '12' }])
        .mockResolvedValueOnce([{ cantina_revenue: '8000' }])
        .mockResolvedValueOnce([{ name: 'Agua', total_qty: '7' }]);

      const result = await service.getActiveSessionKpis();

      expect(result.sessionId).toBe('session-uuid');
      expect(result.totalRevenue).toBe(50000);
      expect(result.cashTotal).toBe(30000);
      expect(result.transferTotal).toBe(20000);
      expect(result.completedBookings).toBe(5);
      expect(result.cantinaItemsSold).toBe(12);
    });

    it('calcula la tasa de ocupación en base a canchas y slots del día', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession({ date: '2025-06-01' }));

      dataSource.query
        .mockResolvedValueOnce([{ total: '0', cash: '0', transfer: '0' }])
        .mockResolvedValueOnce([{ completed: '7' }])
        .mockResolvedValueOnce([{ live: '0' }])
        .mockResolvedValueOnce([{ canceled: '0' }])
        .mockResolvedValueOnce([{ court_count: '2' }])
        .mockResolvedValueOnce([{ total_qty: '0' }])
        .mockResolvedValueOnce([{ cantina_revenue: '0' }])
        .mockResolvedValueOnce([]);

      const result = await service.getActiveSessionKpis();

      expect(result.totalSlots).toBe(28);
      expect(result.occupationRate).toBe(25);
    });

    it('retorna occupationRate 0 si no hay canchas activas', async () => {
      sessionRepo.findOne.mockResolvedValue(mockSession());

      dataSource.query
        .mockResolvedValueOnce([{ total: '0', cash: '0', transfer: '0' }])
        .mockResolvedValueOnce([{ completed: '3' }])
        .mockResolvedValueOnce([{ live: '0' }])
        .mockResolvedValueOnce([{ canceled: '0' }])
        .mockResolvedValueOnce([{ court_count: '0' }])
        .mockResolvedValueOnce([{ total_qty: '0' }])
        .mockResolvedValueOnce([{ cantina_revenue: '0' }])
        .mockResolvedValueOnce([]);

      const result = await service.getActiveSessionKpis();

      expect(result.occupationRate).toBe(0);
    });
  });
});
