import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { ApiModule } from './api.module.js';
import { configureHttpApp } from './bootstrap/configure-http-app.js';

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, { bufferLogs: true });
  await configureHttpApp(app);
  app.set('trust proxy', app.get(ConfigService).getOrThrow<number>('TRUST_PROXY_HOPS'));

  if (app.get(ConfigService).get('NODE_ENV') === 'development') {
    const config = new DocumentBuilder().setTitle('Geniebox API').setVersion('1').addBearerAuth().build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config));
  }

  return app;
}
