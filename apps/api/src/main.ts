import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { ApiModule } from './api.module.js';
import { configureHttpApp } from './bootstrap/configure-http-app.js';
import type { Env } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, { bufferLogs: true });
  configureHttpApp(app, { kind: 'public' });
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PUBLIC_PORT', { infer: true }), config.get('PUBLIC_HOST', { infer: true }));
}

void bootstrap();
