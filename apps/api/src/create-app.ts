import 'reflect-metadata';

import helmet from 'helmet';

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { I18nService } from 'nestjs-i18n';
import { Logger, PinoLogger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';

export async function createApp() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(
    new HttpExceptionFilter(app.get(ClsService), app.get(I18nService), await app.resolve(PinoLogger)),
  );

  if (app.get(ConfigService).get('NODE_ENV') === 'development') {
    const config = new DocumentBuilder().setTitle('Geniebox API').setVersion('1').addBearerAuth().build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config));
  }

  return app;
}
