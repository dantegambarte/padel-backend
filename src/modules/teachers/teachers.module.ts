import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Teacher } from './entities/teacher.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { PricingShift } from '../pricing-shifts/entities/pricing-shift.entity';
import { InternalConsumption } from '../internal-consumption/entities/internal-consumption.entity';
import { CashRegisterModule } from '../cash-register/cash-register.module';
import { TeachersService } from './teachers.service';
import { TeachersController } from './teachers.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Teacher, Booking, PricingShift, InternalConsumption]),
    CashRegisterModule,
  ],
  controllers: [TeachersController],
  providers: [TeachersService],
  exports: [TeachersService],
})
export class TeachersModule {}
