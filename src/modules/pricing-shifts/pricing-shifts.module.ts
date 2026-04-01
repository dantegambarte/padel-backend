import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PricingShift } from './entities/pricing-shift.entity';
import { PricingShiftsService } from './pricing-shifts.service';
import { PricingShiftsController } from './pricing-shifts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PricingShift])],
  controllers: [PricingShiftsController],
  providers: [PricingShiftsService],
  exports: [PricingShiftsService],
})
export class PricingShiftsModule {}
