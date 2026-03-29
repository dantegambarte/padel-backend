import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Booking } from '../bookings/entities/booking.entity';
import { RemindersService } from './reminders.service';
import { RemindersCronService } from './reminders-cron.service';
import { RemindersController } from './reminders.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Booking])],
  controllers: [RemindersController],
  providers: [RemindersService, RemindersCronService],
  exports: [RemindersService],
})
export class RemindersModule {}
