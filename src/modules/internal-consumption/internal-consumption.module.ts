import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InternalConsumption } from './entities/internal-consumption.entity';
import { InternalConsumptionService } from './internal-consumption.service';
import { InternalConsumptionController } from './internal-consumption.controller';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InternalConsumption]),
    ProductsModule, // provides ProductsService + Product repository
  ],
  controllers: [InternalConsumptionController],
  providers: [InternalConsumptionService],
  exports: [InternalConsumptionService],
})
export class InternalConsumptionModule {}
