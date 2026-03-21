import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { Product } from '../products/entities/product.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Sale } from '../pos/entities/sale.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Product, Booking, Sale])],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
