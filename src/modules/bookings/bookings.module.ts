import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

import { Booking } from './entities/booking.entity';
import { BookingItem } from './entities/booking-item.entity';
import { BookingPayment } from './entities/booking-payment.entity';
import { Product } from '../products/entities/product.entity';
import { Court } from '../courts/entities/court.entity';
import { PricingShift } from '../pricing-shifts/entities/pricing-shift.entity';

import { CashRegisterModule } from '../cash-register/cash-register.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, BookingItem, BookingPayment, Product, Court, PricingShift]),
    CashRegisterModule, // Para registrar movimientos en caja al crear turnos
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService], // Exportado para que ReportsModule lo consuma en Fase 5
})
export class BookingsModule {}
