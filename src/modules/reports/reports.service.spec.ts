import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ReportsService } from './reports.service';
import { CashRegisterService } from '../cash-register/cash-register.service';

describe('ReportsService', () => {
  let service: ReportsService;

  const dataSource = {
    query: jest.fn(),
  };

  const cashRegisterService = {
    getActiveSessionKpis: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: DataSource, useValue: dataSource },
        { provide: CashRegisterService, useValue: cashRegisterService },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
    jest.clearAllMocks();
  });

  describe('resolveDateRange (via getRevenue)', () => {
    it('usa dto.date como from y to cuando se especifica', async () => {
      dataSource.query.mockResolvedValue([]);
      await service.getRevenue({ date: '2025-06-01' });
      const call = dataSource.query.mock.calls[0];
      expect(call[1]).toContain('2025-06-01');
    });

    it('usa dateFrom y dateTo cuando se especifican', async () => {
      dataSource.query.mockResolvedValue([]);
      await service.getRevenue({ dateFrom: '2025-06-01', dateTo: '2025-06-30' });
      const call = dataSource.query.mock.calls[0];
      expect(call[1]).toContain('2025-06-01');
      expect(call[1]).toContain('2025-06-30');
    });
  });

  describe('getRevenue', () => {
    it('retorna series de ingresos con period, bookings, sales y total', async () => {
      dataSource.query.mockResolvedValue([
        { period: '2025-06-01', bookings: '45000', sales: '12000' },
        { period: '2025-06-02', bookings: '30000', sales: '8500' },
      ]);

      const result = await service.getRevenue({ date: '2025-06-01' });
      expect(result).toHaveLength(2);
      expect(result[0].total).toBe(57000);
      expect(result[1].bookings).toBe(30000);
    });

    it('retorna array vacío si no hay transacciones', async () => {
      dataSource.query.mockResolvedValue([]);
      const result = await service.getRevenue({ date: '2025-06-01' });
      expect(result).toEqual([]);
    });
  });

  describe('getPaymentMethods', () => {
    it('calcula porcentajes correctamente', async () => {
      dataSource.query.mockResolvedValue([{ cash_total: '75000', transfer_total: '25000' }]);

      const result = await service.getPaymentMethods({ date: '2025-06-01' });
      expect(result.grandTotal).toBe(100000);
      expect(result.cash.percentage).toBe(75);
      expect(result.transfer.percentage).toBe(25);
    });

    it('retorna porcentajes 0 si no hay transacciones', async () => {
      dataSource.query.mockResolvedValue([{ cash_total: '0', transfer_total: '0' }]);
      const result = await service.getPaymentMethods({ date: '2025-06-01' });
      expect(result.cash.percentage).toBe(0);
      expect(result.grandTotal).toBe(0);
    });
  });

  describe('getProductsRanking', () => {
    it('retorna productos con rank, qty y revenue', async () => {
      dataSource.query.mockResolvedValue([
        { product_id: 'p1', product_name: 'Pelota', qty: '48', revenue: '72000' },
        { product_id: 'p2', product_name: 'Gatorade', qty: '35', revenue: '52500' },
      ]);

      const result = await service.getProductsRanking({ date: '2025-06-01' });
      expect(result[0].rank).toBe(1);
      expect(result[0].qty).toBe(48);
      expect(result[1].rank).toBe(2);
    });
  });

  describe('getTransactionsExport', () => {
    it('retorna filas planas listas para CSV', async () => {
      dataSource.query.mockResolvedValue([
        {
          date: '2025-06-01',
          time: '14:32',
          type: 'booking',
          concept: 'Turno Cancha 1',
          cash: '15000',
          transfer: '0',
          total: '15000',
          created_by: 'admin',
        },
      ]);

      const result = await service.getTransactionsExport({ date: '2025-06-01' });
      expect(result).toHaveLength(1);
      expect(result[0].cash).toBe(15000);
      expect(result[0].createdBy).toBe('admin');
    });
  });

  describe('getSummary', () => {
    it('retorna los totales del dashboard parseados', async () => {
      dataSource.query.mockResolvedValue([
        {
          total_revenue: '126000',
          bookings_revenue: '100000',
          sales_revenue: '26000',
          cash_total: '90000',
          transfer_total: '36000',
          tx_count: '42',
        },
      ]);

      const result = await service.getSummary({ date: '2025-06-01' });
      expect(result.totalRevenue).toBe(126000);
      expect(result.bookingsRevenue).toBe(100000);
      expect(result.transactionCount).toBe(42);
    });
  });

  describe('getKpis', () => {
    it('delega a CashRegisterService.getActiveSessionKpis y mapea el resultado', async () => {
      cashRegisterService.getActiveSessionKpis.mockResolvedValue({
        sessionId: 'session-uuid',
        sessionDate: '2025-06-01',
        totalRevenue: 50000,
        cashTotal: 30000,
        transferTotal: 20000,
        completedBookings: 8,
        liveBookings: 2,
        canceledBookings: 1,
        totalOperations: 26,
        totalSlots: 28,
        occupationRate: 28,
        cantinaItemsSold: 15,
        cantinaRevenue: 8000,
        courtsRevenue: 42000,
        topProduct: { name: 'Agua', quantity: 7 },
        averageTicket: 6250,
      });

      const result = await service.getKpis();

      expect(result.totalRevenue).toBe(50000);
      expect(result.cashTotal).toBe(30000);
      expect(result.completedBookings).toBe(8);
      expect(result.occupationRate).toBe(28);
      expect(result.cantinaItemsSold).toBe(15);
    });

    it('retorna ceros si no hay sesión activa', async () => {
      cashRegisterService.getActiveSessionKpis.mockResolvedValue({
        sessionId: null,
        sessionDate: null,
        totalRevenue: 0,
        cashTotal: 0,
        transferTotal: 0,
        completedBookings: 0,
        liveBookings: 0,
        canceledBookings: 0,
        totalOperations: 0,
        totalSlots: 0,
        occupationRate: 0,
        cantinaItemsSold: 0,
        cantinaRevenue: 0,
        courtsRevenue: 0,
        topProduct: null,
        averageTicket: 0,
      });

      const result = await service.getKpis();
      expect(result.totalRevenue).toBe(0);
      expect(result.occupationRate).toBe(0);
    });
  });

  describe('getRevenueTrend', () => {
    it('retorna array con fecha, cash, transfer y total', async () => {
      dataSource.query.mockResolvedValue([
        { date: '2025-05-26', cash: '5000', transfer: '2000' },
        { date: '2025-05-27', cash: '8000', transfer: '3500' },
      ]);

      const result = await service.getRevenueTrend();

      expect(result).toHaveLength(2);
      expect(result[0].total).toBe(7000);
      expect(result[1].cash).toBe(8000);
      expect(result[1].total).toBe(11500);
    });

    it('retorna array vacío si no hay transacciones en los últimos 7 días', async () => {
      dataSource.query.mockResolvedValue([]);
      const result = await service.getRevenueTrend();
      expect(result).toEqual([]);
    });

    it('pasa el parámetro days a la query SQL', async () => {
      dataSource.query.mockResolvedValue([]);
      await service.getRevenueTrend(14);
      const call = dataSource.query.mock.calls[0];
      expect(call[1]).toContain(14);
    });
  });
});
