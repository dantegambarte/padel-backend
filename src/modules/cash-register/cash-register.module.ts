import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashRegisterController } from './cash-register.controller';
import { CashRegisterService } from './cash-register.service';
import { CashSession } from './entities/cash-session.entity';
import { Transaction } from './entities/transaction.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CashSession, Transaction])],
  controllers: [CashRegisterController],
  providers: [CashRegisterService],
  // Exportamos el servicio para que BookingsModule y PosModule
  // puedan inyectarlo en sus transacciones atómicas.
  exports: [CashRegisterService],
})
export class CashRegisterModule {}
