import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Booking } from '../bookings/entities/booking.entity';
import { FixedBooking } from '../fixed-bookings/entities/fixed-booking.entity';
import { Teacher } from '../teachers/entities/teacher.entity';
import { PrivacyController } from './privacy.controller';
import { PrivacyCronService } from './privacy-cron.service';
import { PrivacyService } from './privacy.service';

@Module({
  imports: [TypeOrmModule.forFeature([FixedBooking, Teacher, Booking])],
  controllers: [PrivacyController],
  providers: [PrivacyService, PrivacyCronService],
})
export class PrivacyModule {}
