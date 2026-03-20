import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { CashRegisterModule } from '../cash-register/cash-register.module';

@Module({
  imports: [CashRegisterModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
