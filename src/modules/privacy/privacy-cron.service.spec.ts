import { ConfigService } from '@nestjs/config';
import { PrivacyCronService } from './privacy-cron.service';
import { PrivacyService } from './privacy.service';

describe('PrivacyCronService', () => {
  it('purges phones using CUSTOMER_PHONE_RETENTION_DAYS', async () => {
    const privacy = {
      purgeExpiredPhones: jest.fn().mockResolvedValue({ fixedBookings: 1, teachers: 0 }),
    };
    const config = { get: jest.fn().mockReturnValue(90) };
    const cron = new PrivacyCronService(
      privacy as unknown as PrivacyService,
      config as unknown as ConfigService,
    );

    await cron.purgeExpiredPhones();

    expect(config.get).toHaveBeenCalledWith('CUSTOMER_PHONE_RETENTION_DAYS', 365);
    expect(privacy.purgeExpiredPhones).toHaveBeenCalledWith(90);
  });
});
