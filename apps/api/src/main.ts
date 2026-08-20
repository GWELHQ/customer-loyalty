import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<AppConfig, true>);

  app.enableCors({ origin: config.get('corsOrigin'), credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Green Wells Loyalty Cashback API')
    .setDescription(
      'Centralized fuel loyalty cashback API serving the admin web app and the Android pump-attendant app.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth')
    .addTag('users')
    .addTag('attendants')
    .addTag('stations')
    .addTag('customers')
    .addTag('prices')
    .addTag('sales')
    .addTag('mobile')
    .addTag('special-rate-requests')
    .addTag('reconciliation')
    .addTag('cashback-ledgers')
    .addTag('disbursement-batches')
    .addTag('reports')
    .addTag('notifications')
    .addTag('audit-events')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.get('port');
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on :${port} — docs at /api/docs`);
}

bootstrap();
