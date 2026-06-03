import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { FixedBookingsService } from './fixed-bookings.service';

@Injectable()
export class FixedBookingsCronService {
  private readonly logger = new Logger(FixedBookingsCronService.name);

  constructor(private readonly fixedBookingsService: FixedBookingsService) {}

  /**
   * Extiende automáticamente los turnos fijos activos cada domingo a las 3:00 AM.
   * Esto asegura que los turnos fijos se mantengan actualizados sin intervención manual.
   */
  @Cron('0 3 * * 0')
  async extendFixedBookings(): Promise<void> {
    this.logger.log('[CRON] Iniciando extensión automática de turnos fijos.');
    await this.fixedBookingsService.extendAllActive();
  }
}
