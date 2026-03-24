import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { databaseConfig } from './config/database.config';
import { envValidationSchema } from './config/env.validation';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

// ── Módulos de Fase 2 ────────────────────────────────
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CourtsModule } from './modules/courts/courts.module';
import { SystemConfigModule } from './modules/system-config/system-config.module';

// ── Módulos de Fase 3 ─────────────────────────────────
import { BookingsModule } from './modules/bookings/bookings.module';

// ── Módulos de Fase 4 ─────────────────────────────────
import { ProductsModule } from './modules/products/products.module';
import { PosModule } from './modules/pos/pos.module';

// ── Módulos de Fase 5 ─────────────────────────────────
import { CashRegisterModule } from './modules/cash-register/cash-register.module';
import { ReportsModule } from './modules/reports/reports.module';

// ── Turnos Fijos ──────────────────────────────────────
import { FixedBookingsModule } from './modules/fixed-bookings/fixed-bookings.module';

// ── Módulo transversal ────────────────────────────────
import { SearchModule } from './modules/search/search.module';

@Module({
  imports: [
    // ── Rate limiting global ───────────────────────────
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000, // ventana de 1 minuto (ms)
        limit: 60, // máx. 60 peticiones generales por minuto
      },
    ]),

    // ── Variables de entorno con validación Joi ────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false, // muestra TODOS los errores juntos, no solo el primero
      },
    }),

    // ── Base de datos ──────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: databaseConfig,
    }),

    // ── Módulos de negocio ─────────────────────────────
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
    SearchModule,

  ],
  providers: [
    // Filtro de excepciones HTTP global
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
