import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { configureHttpApp } from './bootstrap/configure-http-app.js';
import type { Env } from './config/env.schema.js';
import { InternalModule } from './internal.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(InternalModule, {
    bufferLogs: true,
  });
  configureHttpApp(app, { kind: 'internal' });
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  // Never bind the internal listener to a public interface.
  await app.listen(
    config.get('INTERNAL_PORT', { infer: true }),
    config.get('INTERNAL_HOST', { infer: true }),
  );
}

void bootstrap();
