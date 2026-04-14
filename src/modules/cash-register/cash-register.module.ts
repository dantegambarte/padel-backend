import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashRegisterController } from './cash-register.controller';
import { CashRegisterService } from './cash-register.service';
import { CashSession } from './entities/cash-session.entity';
import { Transaction } from './entities/transaction.entity';
import { DailyClosureRecord } from './entities/daily-closure.entity';
import { SystemConfigModule } from '../system-config/system-config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CashSession, Transaction, DailyClosureRecord]),
    SystemConfigModule,
  ],
  controllers: [CashRegisterController],
  providers: [CashRegisterService],
  exports: [CashRegisterService],
})
export class CashRegisterModule {}
