import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrivacyService } from './privacy.service';

@Injectable()
export class PrivacyCronService {
  private readonly logger = new Logger(PrivacyCronService.name);

  constructor(
    private readonly privacyService: PrivacyService,
    private readonly config: ConfigService,
  ) {}

  /** Daily at 4 AM: drops phones kept past CUSTOMER_PHONE_RETENTION_DAYS. Logs counts only. */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpiredPhones(): Promise<void> {
    const days = this.config.get<number>('CUSTOMER_PHONE_RETENTION_DAYS', 365);
    const result = await this.privacyService.purgeExpiredPhones(days);
    this.logger.log(
      `[CRON] Phone retention (${days}d): ${result.fixedBookings} fixed bookings, ${result.teachers} teachers purged.`,
    );
  }
}
