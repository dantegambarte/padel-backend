import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BookingsService } from './bookings.service';
import { Booking, BookingStatus, PriceType } from './entities/booking.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { SystemConfigService } from '../system-config/system-config.service';
import { CashRegisterService } from '../cash-register/cash-register.service';

const mockAdmin = (): User =>
  ({ id: 'admin-uuid', username: 'admin', role: UserRole.ADMIN, isActive: true }) as User;

const mockEmployee = (): User =>
  ({ id: 'emp-uuid', username: 'empleado', role: UserRole.EMPLOYEE, isActive: true }) as User;

const mockBooking = (overrides: Partial<Booking> = {}): Booking =>
  ({
    id: 'booking-uuid',
    courtId: 'court-uuid',
    date: '2025-06-01',
    hour: '10:00',
    clientName: 'Juan Pérez',
    status: BookingStatus.BOOKED,
    priceType: PriceType.STANDARD,
    priceAmount: 3000,
    durationMinutes: 60,
    createdByUserId: 'admin-uuid',
    items: [],
    payment: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Booking;

describe('BookingsService', () => {
  let service: BookingsService;

  const mockQb = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    getMany: jest.fn(),
  };

  const bookingRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(mockQb),
  };

  const mockManager = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    increment: jest.fn(),
    decrement: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(mockQb),
  };

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    query: jest.fn(),
    manager: mockManager,
  };

  const dataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  const systemConfigService = {
    getPrices: jest.fn().mockResolvedValue({ standard: 3000, professor: 2500 }),
  };

  const cashRegisterService = {
    getOrCreateActiveSession: jest.fn().mockResolvedValue({ id: 'session-uuid' }),
    registerTransaction: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: bookingRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: SystemConfigService, useValue: systemConfigService },
        { provide: CashRegisterService, useValue: cashRegisterService },
      ],
    }).compile();

    service = module.get<BookingsService>(BookingsService);
    jest.clearAllMocks();

    dataSource.createQueryRunner.mockReturnValue(mockQueryRunner);
    mockQueryRunner.connect.mockResolvedValue(undefined);
    mockQueryRunner.startTransaction.mockResolvedValue(undefined);
    mockQueryRunner.commitTransaction.mockResolvedValue(undefined);
    mockQueryRunner.rollbackTransaction.mockResolvedValue(undefined);
    mockQueryRunner.release.mockResolvedValue(undefined);
    mockQueryRunner.query.mockResolvedValue([]);
    mockQueryRunner.manager = mockManager;
    bookingRepo.createQueryBuilder.mockReturnValue(mockQb);
    mockQb.leftJoinAndSelect.mockReturnThis();
    mockQb.where.mockReturnThis();
    mockQb.andWhere.mockReturnThis();
    mockQb.orderBy.mockReturnThis();
    mockQb.addOrderBy.mockReturnThis();
    mockQb.setLock.mockReturnThis();
    mockManager.createQueryBuilder.mockReturnValue(mockQb);
    systemConfigService.getPrices.mockResolvedValue({ standard: 3000, professor: 2500 });
    cashRegisterService.getOrCreateActiveSession.mockResolvedValue({ id: 'session-uuid' });
    cashRegisterService.registerTransaction.mockResolvedValue({});
  });

  describe('findOne', () => {
    it('retorna el turno con relaciones', async () => {
      bookingRepo.findOne.mockResolvedValue(mockBooking());
      const result = await service.findOne('booking-uuid');
      expect(result.id).toBe('booking-uuid');
    });

    it('lanza NotFoundException si el turno no existe', async () => {
      bookingRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByDate', () => {
    it('retorna los turnos del día', async () => {
      mockQb.getMany.mockResolvedValue([mockBooking()]);
      const result = await service.findByDate({ date: '2025-06-01' });
      expect(result).toHaveLength(1);
    });
  });

  describe('cancel', () => {
    it('lanza ForbiddenException si el usuario no es admin', async () => {
      await expect(service.cancel('booking-uuid', mockEmployee())).rejects.toThrow(ForbiddenException);
    });

    it('lanza BadRequestException si el turno ya está cancelado', async () => {
      mockManager.findOne
        .mockResolvedValueOnce(mockBooking({ status: BookingStatus.CANCELLED }));
      await expect(service.cancel('booking-uuid', mockAdmin())).rejects.toThrow(BadRequestException);
    });

    it('lanza NotFoundException si el turno no existe', async () => {
      mockManager.findOne.mockResolvedValueOnce(null);
      await expect(service.cancel('missing', mockAdmin())).rejects.toThrow(NotFoundException);
    });
  });

  describe('validateStatusTransition (via update)', () => {
    it('permite BOOKED → PLAYING', async () => {
      const booking = mockBooking({ status: BookingStatus.BOOKED });
      mockManager.findOne
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce({ ...booking, items: [], payment: null });
      mockManager.update.mockResolvedValue({});
      bookingRepo.findOne.mockResolvedValue(booking);

      await expect(
        service.update('booking-uuid', { status: BookingStatus.PLAYING }, mockEmployee()),
      ).resolves.toBeDefined();
    });

    it('lanza BadRequestException si el estado ya es terminal (COMPLETED)', async () => {
      const booking = mockBooking({ status: BookingStatus.COMPLETED });
      mockManager.findOne.mockResolvedValueOnce(booking);
      mockManager.findOne.mockResolvedValueOnce({ ...booking, items: [], payment: null });

      await expect(
        service.update('booking-uuid', { status: BookingStatus.CANCELLED }, mockAdmin()),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza ForbiddenException si empleado intenta cancelar', async () => {
      const booking = mockBooking({ status: BookingStatus.BOOKED });
      mockManager.findOne.mockResolvedValueOnce(booking);
      mockManager.findOne.mockResolvedValueOnce({ ...booking, items: [], payment: null });

      await expect(
        service.update('booking-uuid', { status: BookingStatus.CANCELLED }, mockEmployee()),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('handleDbError', () => {
    it('convierte error 23505 en ConflictException al crear', async () => {
      mockManager.findOne
        .mockResolvedValueOnce({ id: 'court-uuid', isActive: true, name: 'Cancha 1' })
        .mockResolvedValueOnce(null);
      mockQb.getOne.mockResolvedValue(null);
      mockManager.create.mockReturnValue(mockBooking());
      mockManager.save
        .mockRejectedValueOnce({ code: '23505' });

      await expect(
        service.create(
          {
            courtId: 'court-uuid',
            date: '2025-06-01',
            hour: '10:00',
            clientName: 'Test',
          },
          mockAdmin(),
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
