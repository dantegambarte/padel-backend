import { Test, TestingModule } from '@nestjs/testing';
import { FixedBookingsCronService } from './fixed-bookings-cron.service';
import { FixedBookingsService } from './fixed-bookings.service';

describe('FixedBookingsCronService', () => {
  let cronService: FixedBookingsCronService;
  let fixedBookingsService: jest.Mocked<
    Pick<FixedBookingsService, 'extendAllActive' | 'syncPrices'>
  >;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FixedBookingsCronService,
        {
          provide: FixedBookingsService,
          useValue: {
            extendAllActive: jest.fn().mockResolvedValue(undefined),
            syncPrices: jest.fn().mockResolvedValue({ updated: 0 }),
          },
        },
      ],
    }).compile();

    cronService = module.get(FixedBookingsCronService);
    fixedBookingsService = module.get(FixedBookingsService);
  });

  it('llama a extendAllActive y syncPrices cuando el cron se dispara', async () => {
    await cronService.weeklyMaintenance();
    expect(fixedBookingsService.extendAllActive).toHaveBeenCalledTimes(1);
    expect(fixedBookingsService.syncPrices).toHaveBeenCalledTimes(1);
  });

  it('propaga el error si extendAllActive falla', async () => {
    (fixedBookingsService.extendAllActive as jest.Mock).mockRejectedValue(new Error('DB down'));
    await expect(cronService.weeklyMaintenance()).rejects.toThrow('DB down');
  });
});
