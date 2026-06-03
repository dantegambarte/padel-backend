import { Test, TestingModule } from '@nestjs/testing';
import { FixedBookingsCronService } from './fixed-bookings-cron.service';
import { FixedBookingsService } from './fixed-bookings.service';

describe('FixedBookingsCronService', () => {
  let cronService: FixedBookingsCronService;
  let fixedBookingsService: jest.Mocked<Pick<FixedBookingsService, 'extendAllActive'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FixedBookingsCronService,
        {
          provide: FixedBookingsService,
          useValue: { extendAllActive: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    cronService = module.get(FixedBookingsCronService);
    fixedBookingsService = module.get(FixedBookingsService);
  });

  it('llama a extendAllActive cuando el cron se dispara', async () => {
    await cronService.extendFixedBookings();
    expect(fixedBookingsService.extendAllActive).toHaveBeenCalledTimes(1);
  });

  it('propaga el error si extendAllActive falla', async () => {
    (fixedBookingsService.extendAllActive as jest.Mock).mockRejectedValue(new Error('DB down'));
    await expect(cronService.extendFixedBookings()).rejects.toThrow('DB down');
  });
});
