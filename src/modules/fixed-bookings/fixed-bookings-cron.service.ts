import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { FixedBookingsService } from './fixed-bookings.service';

@Injectable()
export class FixedBookingsCronService {
  private readonly logger = new Logger(FixedBookingsCronService.name);

  constructor(private readonly fixedBookingsService: FixedBookingsService) {}

  /**
   * Cron job que se ejecuta todos los días a las 3 AM para extender los turnos fijos activos y sincronizar los precios.
   * Esto asegura que los turnos fijos se mantengan actualizados y que los precios reflejen cualquier cambio reciente.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async weeklyMaintenance(): Promise<void> {
    this.logger.log('[CRON] Iniciando mantenimiento semanal de turnos fijos.');
    await this.fixedBookingsService.extendAllActive();
    await this.fixedBookingsService.syncPrices();
    this.logger.log('[CRON] Mantenimiento semanal finalizado.');
  }
}
