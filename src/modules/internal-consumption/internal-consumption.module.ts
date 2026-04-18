import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InternalConsumption } from './entities/internal-consumption.entity';
import { InternalConsumptionService } from './internal-consumption.service';
import { InternalConsumptionController } from './internal-consumption.controller';
import { ProductsModule } from '../products/products.module';
import { CashRegisterModule } from '../cash-register/cash-register.module';

@Module({
  imports: [TypeOrmModule.forFeature([InternalConsumption]), ProductsModule, CashRegisterModule],
  controllers: [InternalConsumptionController],
  providers: [InternalConsumptionService],
  exports: [InternalConsumptionService],
})
export class InternalConsumptionModule {}
