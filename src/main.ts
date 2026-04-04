import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ── CORS ────────────────────────────────────────────
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:4200',
    credentials: true,
  });

  // ── Prefijo global de API ───────────────────────────
  app.setGlobalPrefix('api/v1');

  // ── Serialización global (excluye campos @Exclude()) ──
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // ── Validación global ───────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // elimina props no declaradas en DTOs
      forbidNonWhitelisted: true,
      transform: true, // convierte tipos automáticamente
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ── Swagger (solo en desarrollo) ───────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('PadelSys API')
      .setDescription('Sistema de Gestión para Club de Pádel')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    console.log(`📖 Swagger docs: http://localhost:${process.env.PORT || 3000}/api/docs`);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 PadelSys API corriendo en: http://localhost:${port}/api/v1`);
}

bootstrap();
