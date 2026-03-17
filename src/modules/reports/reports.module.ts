import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

// ReportsService usa InjectDataSource directamente (raw SQL),
// no necesita repositorios TypeORM ni importar otros módulos.
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
