import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

import { databaseConfig } from './config/database.config';
import { envValidationSchema } from './config/env.validation';
import { THROTTLE_LIMITS } from './config/throttle-limits';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CourtsModule } from './modules/courts/courts.module';
import { SystemConfigModule } from './modules/system-config/system-config.module';

import { BookingsModule } from './modules/bookings/bookings.module';

import { ProductsModule } from './modules/products/products.module';
import { PosModule } from './modules/pos/pos.module';

import { CashRegisterModule } from './modules/cash-register/cash-register.module';
import { ReportsModule } from './modules/reports/reports.module';

import { FixedBookingsModule } from './modules/fixed-bookings/fixed-bookings.module';

import { TeachersModule } from './modules/teachers/teachers.module';

import { RemindersModule } from './modules/reminders/reminders.module';

import { ExpensesModule } from './modules/expenses/expenses.module';
import { InternalConsumptionModule } from './modules/internal-consumption/internal-consumption.module';

import { PricingShiftsModule } from './modules/pricing-shifts/pricing-shifts.module';

import { SearchModule } from './modules/search/search.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),

    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: THROTTLE_LIMITS.global,
      },
    ]),

    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: databaseConfig,
    }),

    AuthModule,
    UsersModule,
    CourtsModule,
    SystemConfigModule,
    BookingsModule,
    ProductsModule,
    PosModule,
    CashRegisterModule,
    ReportsModule,
    FixedBookingsModule,
    TeachersModule,
    RemindersModule,
    ExpensesModule,
    InternalConsumptionModule,
    PricingShiftsModule,
    SearchModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Authentication is on by default: opt out per route with @Public().
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
