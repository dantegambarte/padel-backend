import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BookingsService } from './bookings.service';
import { Booking, BookingStatus, PriceType } from './entities/booking.entity';
import { SystemConfig } from '../system-config/entities/system-config.entity';
import { User, UserRole } from '../users/entities/user.entity';
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
    delete: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    execute: jest.fn(),
    getOne: jest.fn(),
    getMany: jest.fn(),
  };

  const bookingRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(mockQb),
  };

  const mockManager = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
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

  const systemConfigRepo = {
    findOne: jest.fn().mockResolvedValue(null),
  };

  const cashRegisterService = {
    getActiveSessionOrFail: jest.fn().mockResolvedValue({ id: 'session-uuid' }),
    registerTransaction: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: bookingRepo },
        { provide: getRepositoryToken(SystemConfig), useValue: systemConfigRepo },
        { provide: DataSource, useValue: dataSource },
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
    mockQb.delete.mockReturnThis();
    mockQb.from.mockReturnThis();
    mockQb.execute.mockResolvedValue({});
    mockManager.find.mockResolvedValue([]);
    mockManager.createQueryBuilder.mockReturnValue(mockQb);
    systemConfigRepo.findOne.mockResolvedValue(null);
    cashRegisterService.getActiveSessionOrFail.mockResolvedValue({ id: 'session-uuid' });
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

    it('retorna array vacío si no hay turnos', async () => {
      mockQb.getMany.mockResolvedValue([]);
      const result = await service.findByDate({ date: '2025-06-01' });
      expect(result).toHaveLength(0);
    });
  });

  describe('cancel', () => {
    it('lanza ForbiddenException si el usuario no es admin', async () => {
      await expect(service.cancel('booking-uuid', mockEmployee())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lanza BadRequestException si el turno ya está cancelado', async () => {
      mockManager.findOne.mockResolvedValueOnce(mockBooking({ status: BookingStatus.CANCELLED }));
      await expect(service.cancel('booking-uuid', mockAdmin())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza NotFoundException si el turno no existe', async () => {
      mockManager.findOne.mockResolvedValueOnce(null);
      await expect(service.cancel('missing', mockAdmin())).rejects.toThrow(NotFoundException);
    });

    it('cancela el turno y hace commit', async () => {
      mockManager.findOne.mockResolvedValueOnce(mockBooking({ status: BookingStatus.BOOKED }));
      mockManager.update.mockResolvedValue({});

      await service.cancel('booking-uuid', mockAdmin());

      expect(mockManager.update).toHaveBeenCalledWith(
        Booking,
        { id: 'booking-uuid' },
        { status: BookingStatus.CANCELLED },
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
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

    it('permite PLAYING → COMPLETED cuando el pago cubre el total', async () => {
      const booking = mockBooking({
        status: BookingStatus.PLAYING,
        priceAmount: 3000,
        durationMinutes: 60,
      });
      const payment = { id: 'pay-uuid', amountCash: 3000, amountTransfer: 0 };
      mockManager.findOne
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce({ ...booking, items: [], payment })
        .mockResolvedValueOnce({ ...booking, items: [] });
      mockManager.update.mockResolvedValue({});
      bookingRepo.findOne.mockResolvedValue({ ...booking, status: BookingStatus.COMPLETED });

      await expect(
        service.update('booking-uuid', { status: BookingStatus.COMPLETED }, mockAdmin()),
      ).resolves.toBeDefined();
    });

    it('lanza BadRequestException si el estado ya es terminal (COMPLETED)', async () => {
      const booking = mockBooking({ status: BookingStatus.COMPLETED });
      mockManager.findOne
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce({ ...booking, items: [], payment: null });

      await expect(
        service.update('booking-uuid', { status: BookingStatus.CANCELLED }, mockAdmin()),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si el estado ya es terminal (CANCELLED)', async () => {
      const booking = mockBooking({ status: BookingStatus.CANCELLED });
      mockManager.findOne
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce({ ...booking, items: [], payment: null });

      await expect(
        service.update('booking-uuid', { status: BookingStatus.PLAYING }, mockAdmin()),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza ForbiddenException si empleado intenta cancelar', async () => {
      const booking = mockBooking({ status: BookingStatus.BOOKED });
      mockManager.findOne
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce({ ...booking, items: [], payment: null });

      await expect(
        service.update('booking-uuid', { status: BookingStatus.CANCELLED }, mockEmployee()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lanza BadRequestException en transición inválida (BOOKED → COMPLETED)', async () => {
      const booking = mockBooking({ status: BookingStatus.BOOKED });
      mockManager.findOne
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce({ ...booking, items: [], payment: null });

      await expect(
        service.update('booking-uuid', { status: BookingStatus.COMPLETED }, mockAdmin()),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('reschedule via update (courtId/date/hour)', () => {
    const moveDto = { courtId: 'new-court-uuid', date: '2025-06-02', hour: '14:00' };
    const mockCourt = { id: 'new-court-uuid', name: 'Cancha 2', isActive: true };

    it('mueve el turno al slot destino y hace commit', async () => {
      const booking = mockBooking({ status: BookingStatus.BOOKED });
      mockManager.findOne
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce({ ...booking, items: [], payment: null })
        .mockResolvedValueOnce(mockCourt);
      mockQb.getOne.mockResolvedValue(null);
      mockManager.update.mockResolvedValue({});
      bookingRepo.findOne.mockResolvedValue({ ...booking, ...moveDto });

      await service.update('booking-uuid', moveDto, mockEmployee());

      expect(mockManager.update).toHaveBeenCalledWith(
        Booking,
        { id: 'booking-uuid' },
        expect.objectContaining({ courtId: 'new-court-uuid', date: '2025-06-02', hour: '14:00' }),
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('lanza NotFoundException si el turno no existe', async () => {
      mockManager.findOne.mockResolvedValueOnce(null);
      await expect(service.update('missing', moveDto, mockAdmin())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza NotFoundException si la cancha destino no existe o está inactiva', async () => {
      const booking = mockBooking({ status: BookingStatus.BOOKED });
      mockManager.findOne
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce({ ...booking, items: [], payment: null })
        .mockResolvedValueOnce(null);
      await expect(service.update('booking-uuid', moveDto, mockAdmin())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza ConflictException si el slot destino ya está ocupado', async () => {
      const booking = mockBooking({ status: BookingStatus.BOOKED });
      mockManager.findOne
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce({ ...booking, items: [], payment: null })
        .mockResolvedValueOnce(mockCourt);
      mockQb.getOne.mockResolvedValue(mockBooking({ id: 'other-booking', clientName: 'María' }));
      await expect(service.update('booking-uuid', moveDto, mockAdmin())).rejects.toThrow(
        ConflictException,
      );
    });

    it('lanza ForbiddenException si empleado intenta mover un turno COMPLETED', async () => {
      const booking = mockBooking({ status: BookingStatus.COMPLETED });
      mockManager.findOne
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce({ ...booking, items: [], payment: null });
      await expect(service.update('booking-uuid', moveDto, mockEmployee())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lanza ForbiddenException si empleado intenta mover un turno CANCELLED', async () => {
      const booking = mockBooking({ status: BookingStatus.CANCELLED });
      mockManager.findOne
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce({ ...booking, items: [], payment: null });
      await expect(service.update('booking-uuid', moveDto, mockEmployee())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('admin puede mover un turno en estado COMPLETED', async () => {
      const booking = mockBooking({ status: BookingStatus.COMPLETED });
      mockManager.findOne
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce({ ...booking, items: [], payment: null })
        .mockResolvedValueOnce(mockCourt);
      mockQb.getOne.mockResolvedValue(null);
      mockManager.update.mockResolvedValue({});
      bookingRepo.findOne.mockResolvedValue({ ...booking, ...moveDto });
      await expect(service.update('booking-uuid', moveDto, mockAdmin())).resolves.toBeDefined();
    });
  });

  describe('create with sourceId (duplicate)', () => {
    const sourceBooking = mockBooking({
      clientName: 'Carlos Rodríguez',
      priceType: PriceType.STANDARD,
      durationMinutes: 60,
      items: [],
    });
    const dupDto = {
      sourceId: 'booking-uuid',
      courtId: 'court-uuid',
      date: '2025-06-02',
      hour: '14:00',
    };
    const mockCourt = {
      id: 'court-uuid',
      name: 'Cancha 1',
      isActive: true,
      price30: 2000,
      price60: 3000,
      price90: 4000,
      price120: 5000,
    };

    it('lanza NotFoundException si el turno original no existe', async () => {
      bookingRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.create({ ...dupDto, sourceId: 'missing' }, mockAdmin())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('hereda clientName, priceType y durationMinutes del turno original', async () => {
      bookingRepo.findOne.mockResolvedValueOnce(sourceBooking);
      mockManager.findOne.mockResolvedValueOnce(mockCourt);
      mockQb.getOne.mockResolvedValue(null);
      const createdBooking = mockBooking({ clientName: 'Carlos Rodríguez' });
      mockManager.create
        .mockReturnValueOnce(createdBooking)
        .mockReturnValueOnce({ amountCash: 0, amountTransfer: 0 });
      mockManager.save
        .mockResolvedValueOnce({ ...createdBooking, id: 'new-booking-uuid' })
        .mockResolvedValueOnce({ id: 'payment-uuid' });
      const finalBooking = mockBooking({
        id: 'new-booking-uuid',
        clientName: 'Carlos Rodríguez',
        priceType: PriceType.STANDARD,
        durationMinutes: 60,
      });
      bookingRepo.findOne.mockResolvedValueOnce(finalBooking);

      const result = await service.create(dupDto, mockAdmin());

      expect(result.clientName).toBe('Carlos Rodríguez');
      expect(result.priceType).toBe(PriceType.STANDARD);
      expect(result.durationMinutes).toBe(60);
    });

    it('el nuevo turno comienza con pago en $0', async () => {
      bookingRepo.findOne.mockResolvedValueOnce(sourceBooking);
      mockManager.findOne.mockResolvedValueOnce(mockCourt);
      mockQb.getOne.mockResolvedValue(null);
      const createdBooking = mockBooking();
      mockManager.create
        .mockReturnValueOnce(createdBooking)
        .mockReturnValueOnce({ amountCash: 0, amountTransfer: 0 });
      mockManager.save
        .mockResolvedValueOnce({ ...createdBooking, id: 'new-booking-uuid' })
        .mockResolvedValueOnce({ id: 'payment-uuid' });
      bookingRepo.findOne.mockResolvedValueOnce(mockBooking({ id: 'new-booking-uuid' }));

      await service.create(dupDto, mockAdmin());

      expect(mockManager.create).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({ amountCash: 0, amountTransfer: 0 }),
      );
    });
  });

  describe('handleDbError', () => {
    it('convierte error 23505 en ConflictException al crear', async () => {
      mockManager.findOne.mockResolvedValue({ id: 'court-uuid', isActive: true, name: 'Cancha 1' });
      mockQb.getOne.mockResolvedValue(null);
      mockManager.create.mockReturnValue(mockBooking());
      mockManager.save.mockRejectedValueOnce({ code: '23505' });

      await expect(
        service.create(
          { courtId: 'court-uuid', date: '2025-06-01', hour: '10:00', clientName: 'Test' },
          mockAdmin(),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('convierte error 23514 en BadRequestException (stock negativo)', async () => {
      mockManager.findOne.mockResolvedValue({ id: 'court-uuid', isActive: true, name: 'Cancha 1' });
      mockQb.getOne.mockResolvedValue(null);
      mockManager.create.mockReturnValue(mockBooking());
      mockManager.save.mockRejectedValueOnce({ code: '23514' });

      await expect(
        service.create(
          { courtId: 'court-uuid', date: '2025-06-01', hour: '10:00', clientName: 'Test' },
          mockAdmin(),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
