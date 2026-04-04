import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FixedBookingsController } from './fixed-bookings.controller';
import { FixedBookingsService } from './fixed-bookings.service';

import { FixedBooking } from './entities/fixed-booking.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Court } from '../courts/entities/court.entity';
import { PricingShift } from '../pricing-shifts/entities/pricing-shift.entity';

@Module({
  imports: [TypeOrmModule.forFeature([FixedBooking, Booking, Court, PricingShift])],
  controllers: [FixedBookingsController],
  providers: [FixedBookingsService],
  exports: [FixedBookingsService],
})
export class FixedBookingsModule {}
