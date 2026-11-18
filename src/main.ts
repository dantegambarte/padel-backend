import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor, ConsoleLogger, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { THROTTLE_LIMITS } from './config/throttle-limits';
import { ErrorReporter } from './common/error-reporting/error-reporter';
import { useJsonLogs } from './config/logging';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({ json: useJsonLogs(process.env) }),
  });
  const logger = new Logger('Bootstrap');

  // Errors outside the HTTP pipeline still reach the reporter. The monitor only observes:
  // the process still crashes (and PM2 restarts it); unhandled rejections arrive here too.
  const errorReporter = app.get(ErrorReporter);
  process.on('uncaughtExceptionMonitor', (error) =>
    errorReporter.report(error, { source: 'uncaughtException' }),
  );

  app.use(helmet());
  // Parses the HttpOnly refresh_token cookie read by POST /auth/refresh.
  app.use(cookieParser());

  // Explicit body limits (same as Express defaults) so a change is a visible decision.
  app.useBodyParser('json', { limit: '100kb' });
  app.useBodyParser('urlencoded', { limit: '100kb', extended: true });

  const allowedOrigins: string[] = (process.env.ALLOWED_ORIGINS || 'http://localhost:4200')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin '${origin}' not allowed by CORS`));
      }
    },
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('PadelSys API')
      .setDescription('Sistema de Gestión para Club de Pádel')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('refresh_token')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    logger.log(`Swagger docs: http://localhost:${process.env.PORT || 3000}/api/docs`);
  }

  const port = process.env.PORT || 3000;
  const host = process.env.HOST ?? '0.0.0.0';
  if (THROTTLE_LIMITS.relaxed) {
    new Logger('Throttler').warn(
      `E2E_RELAX_THROTTLE=1: rate limits relaxed (global ${THROTTLE_LIMITS.global}/min, login ${THROTTLE_LIMITS.login}/min). Never use this outside local e2e runs.`,
    );
  }

  await app.listen(port, host);
  logger.log(`PadelSys API listening on: http://localhost:${port}/api/v1`);
}

bootstrap();
