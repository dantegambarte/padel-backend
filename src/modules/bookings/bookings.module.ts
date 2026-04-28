import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

import { Court } from '../courts/entities/court.entity';
import { PricingShift } from '../pricing-shifts/entities/pricing-shift.entity';
import { Product } from '../products/entities/product.entity';
import { SystemConfig } from '../system-config/entities/system-config.entity';
import { BookingItem } from './entities/booking-item.entity';
import { BookingPayment } from './entities/booking-payment.entity';
import { Booking } from './entities/booking.entity';

import { CashRegisterModule } from '../cash-register/cash-register.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      BookingItem,
      BookingPayment,
      Product,
      Court,
      PricingShift,
      SystemConfig,
    ]),
    CashRegisterModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
