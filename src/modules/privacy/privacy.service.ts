import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Booking } from '../bookings/entities/booking.entity';
import { FixedBooking } from '../fixed-bookings/entities/fixed-booking.entity';
import { Teacher } from '../teachers/entities/teacher.entity';

/** Placeholder written over a customer's name on erasure. */
export const ANONYMIZED_NAME = 'Anonymized';

const DAY_MS = 24 * 60 * 60 * 1000;
const PHONE_DIGITS_SQL = "regexp_replace(phone_number, '\\D', '', 'g') = :digits";

export interface PurgeResult {
  fixedBookings: number;
  teachers: number;
}

export interface EraseResult extends PurgeResult {
  bookings: number;
}

export interface CustomerExport {
  phone: string;
  fixedBookings: FixedBooking[];
  teachers: Teacher[];
}

/**
 * Retention, export and erasure of customer phone numbers.
 * Phones live only in fixed_bookings.phone_number and teachers.phone_number.
 */
@Injectable()
export class PrivacyService {
  constructor(
    @InjectRepository(FixedBooking) private readonly fixedBookings: Repository<FixedBooking>,
    @InjectRepository(Teacher) private readonly teachers: Repository<Teacher>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
  ) {}

  /**
   * Nulls the phone of inactive fixed bookings and teachers not updated for
   * `retentionDays`. Active records keep it: reminders need it.
   */
  async purgeExpiredPhones(retentionDays: number, now = new Date()): Promise<PurgeResult> {
    if (!Number.isInteger(retentionDays) || retentionDays < 1) {
      throw new Error('retentionDays must be a positive integer');
    }
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);

    const fixed = await this.fixedBookings
      .createQueryBuilder()
      .update()
      .set({ phoneNumber: null })
      .where('is_active = false')
      .andWhere('phone_number IS NOT NULL')
      .andWhere('updated_at < :cutoff', { cutoff })
      .execute();
    const teachers = await this.teachers
      .createQueryBuilder()
      .update()
      .set({ phoneNumber: null })
      .where('is_active = false')
      .andWhere('phone_number IS NOT NULL')
      .andWhere('updated_at < :cutoff', { cutoff })
      .execute();

    return { fixedBookings: fixed.affected ?? 0, teachers: teachers.affected ?? 0 };
  }

  /** Returns every stored record that holds the given phone (data-subject access request). */
  async exportByPhone(phone: string): Promise<CustomerExport> {
    const digits = toDigits(phone);
    const fixedBookings = await this.fixedBookings
      .createQueryBuilder()
      .where(PHONE_DIGITS_SQL, { digits })
      .getMany();
    const teachers = await this.teachers
      .createQueryBuilder()
      .where(PHONE_DIGITS_SQL, { digits })
      .getMany();
    return { phone: digits, fixedBookings, teachers };
  }

  /**
   * Erasure on request: nulls the phone wherever it appears and anonymizes the
   * name on matching fixed bookings and the bookings they generated. Teacher
   * names are kept because settlements reference them.
   */
  async eraseByPhone(phone: string): Promise<EraseResult> {
    const digits = toDigits(phone);
    const matches = await this.fixedBookings
      .createQueryBuilder()
      .select('id', 'id')
      .where(PHONE_DIGITS_SQL, { digits })
      // Raw rows: getMany would hydrate nothing without the aliased primary key.
      .getRawMany<{ id: string }>();
    const ids = matches.map((m) => m.id);

    const fixed = await this.fixedBookings
      .createQueryBuilder()
      .update()
      .set({ phoneNumber: null, clientName: ANONYMIZED_NAME })
      .where(PHONE_DIGITS_SQL, { digits })
      .execute();
    const teachers = await this.teachers
      .createQueryBuilder()
      .update()
      .set({ phoneNumber: null })
      .where(PHONE_DIGITS_SQL, { digits })
      .execute();

    let bookings = 0;
    if (ids.length > 0) {
      const res = await this.bookings
        .createQueryBuilder()
        .update()
        .set({ clientName: ANONYMIZED_NAME })
        .where('fixed_booking_id IN (:...ids)', { ids })
        .execute();
      bookings = res.affected ?? 0;
    }
    return { fixedBookings: fixed.affected ?? 0, teachers: teachers.affected ?? 0, bookings };
  }
}

function toDigits(phone: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 0) throw new BadRequestException('phone must contain digits');
  return digits;
}
