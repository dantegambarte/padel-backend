import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { RemindersService } from './reminders.service';

/**
 * Cron horario que detecta turnos fijos con precisión de ±1 hora:
 *  - Ventana 23-24h → alerta "mañana juega X"
 *  - Ventana  1-2h  → alerta "hoy juega X en 1 hora"
 *
 * Se ejecuta cada hora. Un Set en memoria evita duplicados dentro
 * del mismo día del servidor; se reinicia automáticamente a medianoche.
 */
@Injectable()
export class RemindersCronService {
  private readonly logger = new Logger(RemindersCronService.name);

  /** IDs de bookings ya alertados (ventana 24h) en la fecha actual del servidor. */
  private readonly alerted24h = new Set<string>();
  /** IDs de bookings ya alertados (ventana mismo día) en la fecha actual. */
  private readonly alertedSameDay = new Set<string>();
  /** Fecha en que se llenaron los Sets (YYYY-MM-DD local). */
  private trackingDate = '';

  constructor(private readonly remindersService: RemindersService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlyReminders(): Promise<void> {
    this.resetTrackingIfNewDay();

    try {
      const { alert24h, alertSameDay } =
        await this.remindersService.getUpcomingForCron();

      for (const item of alert24h) {
        if (this.alerted24h.has(item.bookingId)) continue;
        this.alerted24h.add(item.bookingId);
        this.logger.log(
          `[24h] ${item.clientName} — ${item.hour}hs en ${item.courtName} | ${item.date} | Tel: ${item.phoneNumber ?? 'sin número'}`,
        );
      }

      for (const item of alertSameDay) {
        if (this.alertedSameDay.has(item.bookingId)) continue;
        this.alertedSameDay.add(item.bookingId);
        this.logger.log(
          `[HOY] ${item.clientName} — ${item.hour}hs en ${item.courtName} | Tel: ${item.phoneNumber ?? 'sin número'}`,
        );
      }
    } catch (err) {
      this.logger.error('Error procesando recordatorios horarios', err);
    }
  }

  private resetTrackingIfNewDay(): void {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (today !== this.trackingDate) {
      this.alerted24h.clear();
      this.alertedSameDay.clear();
      this.trackingDate = today;
    }
  }
}
