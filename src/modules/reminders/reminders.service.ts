import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';

import { Booking, BookingStatus } from '../bookings/entities/booking.entity';

export interface ReminderItem {
  bookingId: string;
  clientName: string;
  phoneNumber: string | null;
  courtName: string;
  date: string;
  hour: string;
}

export interface UpcomingReminders {
  today: ReminderItem[];
  tomorrow: ReminderItem[];
}

export interface CronReminders {
  /** Turnos entre 23 y 24 horas en el futuro (alerta "mañana"). */
  alert24h: ReminderItem[];
  /** Turnos entre 1 y 2 horas en el futuro (alerta "hoy"). */
  alertSameDay: ReminderItem[];
}

@Injectable()
export class RemindersService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
  ) {}

  /**
   * Devuelve los turnos fijos (bookings con fixedBookingId != null)
   * que caen hoy y mañana, activos (no cancelados).
   * Usado tanto por el cron como por el endpoint de polling del frontend.
   */
  async getUpcoming(): Promise<UpcomingReminders> {
    const now = new Date();
    const todayStr = this.localDateStr(0);
    const tomorrowStr = this.localDateStr(1);

    const [todayRows, tomorrowRows] = await Promise.all([
      this.queryForDate(todayStr),
      this.queryForDate(tomorrowStr),
    ]);

    // Solo incluir los de mañana que estén a ≤ 24 horas desde ahora.
    // Si el turno es a las 10:00 y ahora son las 11:30, faltan 22.5h → sí aparece.
    // Si faltan 25h → no aparece todavía.
    const tomorrowWithin24h = tomorrowRows.filter((b) => {
      const bookingTime = this.parseBookingDateTime(b.date, b.hour);
      const diffHours = (bookingTime.getTime() - now.getTime()) / 3_600_000;
      return diffHours <= 24;
    });

    return {
      today: todayRows.map((b) => this.toItem(b)),
      tomorrow: tomorrowWithin24h.map((b) => this.toItem(b)),
    };
  }

  /**
   * Versión para el cron horario: devuelve los turnos fijos que caen
   * exactamente en la ventana de 23-24h (alerta "mañana") o 1-2h (alerta "hoy")
   * desde el momento actual.
   */
  async getUpcomingForCron(): Promise<CronReminders> {
    const now = new Date();
    const todayStr = this.localDateStr(0);
    const tomorrowStr = this.localDateStr(1);

    const bookings = await this.bookingRepo.find({
      where: [
        { date: todayStr,    fixedBookingId: Not(IsNull()), status: Not(BookingStatus.CANCELLED) },
        { date: tomorrowStr, fixedBookingId: Not(IsNull()), status: Not(BookingStatus.CANCELLED) },
      ],
      relations: ['court', 'fixedBooking'],
    });

    const alert24h: ReminderItem[] = [];
    const alertSameDay: ReminderItem[] = [];

    for (const booking of bookings) {
      const bookingTime = this.parseBookingDateTime(booking.date, booking.hour);
      const diffHours = (bookingTime.getTime() - now.getTime()) / 3_600_000;

      if (diffHours >= 23 && diffHours < 24) {
        alert24h.push(this.toItem(booking));
      } else if (diffHours >= 1 && diffHours < 2) {
        alertSameDay.push(this.toItem(booking));
      }
    }

    return { alert24h, alertSameDay };
  }

  // ── Privado ──────────────────────────────────────────────────────────────

  private async queryForDate(date: string): Promise<Booking[]> {
    return this.bookingRepo.find({
      where: {
        date,
        fixedBookingId: Not(IsNull()),
        status: Not(BookingStatus.CANCELLED),
      },
      relations: ['court', 'fixedBooking'],
      order: { hour: 'ASC' },
    });
  }

  private toItem(booking: Booking): ReminderItem {
    return {
      bookingId: booking.id,
      clientName: booking.clientName,
      phoneNumber: booking.fixedBooking?.phoneNumber ?? null,
      courtName: booking.court?.name ?? '',
      date: booking.date,
      hour: booking.hour,
    };
  }

  /** Convierte date (YYYY-MM-DD) + hour (HH:MM) a un Date local. */
  private parseBookingDateTime(date: string, hour: string): Date {
    const [y, mo, d] = date.split('-').map(Number);
    const [h, min] = hour.split(':').map(Number);
    return new Date(y, mo - 1, d, h, min, 0);
  }

  /** Formatea la fecha local (UTC-3 safe) N días desde hoy. */
  private localDateStr(daysFromNow: number): string {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
