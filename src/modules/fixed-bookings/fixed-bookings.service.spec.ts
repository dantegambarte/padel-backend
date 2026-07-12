import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { FixedBookingsService } from './fixed-bookings.service';
import { FixedBooking } from './entities/fixed-booking.entity';
import { Booking, BookingStatus, PriceType } from '../bookings/entities/booking.entity';
import { Court } from '../courts/entities/court.entity';
import { PricingShift } from '../pricing-shifts/entities/pricing-shift.entity';

const mockShift = (overrides = {}) => ({
  id: 'shift-uuid',
  name: 'Turno Noche',
  isActive: true,
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: '20:00',
  endTime: '23:00',
  price60min: 5000,
  price30min: 2500,
  price90min: 7500,
  price120min: 10000,
  teacherPricePerHour: null,
  ...overrides,
});

const mockBooking = (overrides: Partial<Booking> = {}): Booking =>
  ({
    id: 'booking-uuid',
    courtId: 'court-uuid',
    date: '2099-12-01',
    hour: '21:00',
    clientName: 'Juan Pérez',
    durationMinutes: 60,
    status: BookingStatus.BOOKED,
    priceType: PriceType.STANDARD,
    priceAmount: 3000,
    appliedShiftName: 'Turno Viejo',
    fixedBookingId: 'fixed-uuid',
    teacherId: null,
    teacherRateSnapshot: null,
    ...overrides,
  }) as Booking;

describe('FixedBookingsService — syncPrices', () => {
  let service: FixedBookingsService;

  const mockQb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };

  const bookingRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    save: jest.fn(),
  };

  const shiftRepo = {
    find: jest.fn(),
  };

  const fixedRepo = {};
  const courtRepo = {};
  const dataSource = { createQueryRunner: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FixedBookingsService,
        { provide: getRepositoryToken(FixedBooking), useValue: fixedRepo },
        { provide: getRepositoryToken(Booking), useValue: bookingRepo },
        { provide: getRepositoryToken(Court), useValue: courtRepo },
        { provide: getRepositoryToken(PricingShift), useValue: shiftRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(FixedBookingsService);
    jest.clearAllMocks();
    bookingRepo.createQueryBuilder.mockReturnValue(mockQb);
    mockQb.where.mockReturnThis();
    mockQb.andWhere.mockReturnThis();
  });

  it('actualiza bookings cuyo precio cambió', async () => {
    const booking = mockBooking({ priceAmount: 3000, appliedShiftName: 'Turno Viejo' });
    mockQb.getMany.mockResolvedValue([booking]);
    shiftRepo.find.mockResolvedValue([mockShift()]);
    bookingRepo.save.mockResolvedValue(booking);

    const result = await service.syncPrices();

    expect(result).toEqual({ updated: 1 });
    expect(bookingRepo.save).toHaveBeenCalledTimes(1);
    expect(bookingRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ priceAmount: 5000, appliedShiftName: 'Turno Noche' }),
    );
  });

  it('no toca bookings cuyo precio ya es correcto', async () => {
    const booking = mockBooking({ priceAmount: 5000, appliedShiftName: 'Turno Noche' });
    mockQb.getMany.mockResolvedValue([booking]);
    shiftRepo.find.mockResolvedValue([mockShift()]);

    const result = await service.syncPrices();

    expect(result).toEqual({ updated: 0 });
    expect(bookingRepo.save).not.toHaveBeenCalled();
  });

  it('asigna precio 0 si no hay franja horaria y no actualiza si ya era 0', async () => {
    const booking = mockBooking({ priceAmount: 0, appliedShiftName: 'Estándar' });
    mockQb.getMany.mockResolvedValue([booking]);
    shiftRepo.find.mockResolvedValue([]);

    const result = await service.syncPrices();

    expect(result).toEqual({ updated: 0 });
    expect(bookingRepo.save).not.toHaveBeenCalled();
  });

  it('retorna updated 0 si no hay bookings futuros', async () => {
    mockQb.getMany.mockResolvedValue([]);
    shiftRepo.find.mockResolvedValue([mockShift()]);

    const result = await service.syncPrices();

    expect(result).toEqual({ updated: 0 });
    expect(bookingRepo.save).not.toHaveBeenCalled();
  });

  it('actualiza teacherRateSnapshot en bookings de profesor', async () => {
    const booking = mockBooking({
      teacherId: 'teacher-uuid',
      priceType: PriceType.PROFESSOR,
      priceAmount: 3000,
      appliedShiftName: 'Turno Viejo',
    });
    mockQb.getMany.mockResolvedValue([booking]);
    shiftRepo.find.mockResolvedValue([mockShift({ teacherPricePerHour: 4000 })]);
    bookingRepo.save.mockResolvedValue(booking);

    const result = await service.syncPrices();

    expect(result).toEqual({ updated: 1 });
    expect(bookingRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ teacherRateSnapshot: 4000 }),
    );
  });
});
