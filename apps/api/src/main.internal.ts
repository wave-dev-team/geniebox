import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { configureHttpApp } from './bootstrap/configure-http-app.js';
import { InternalModule } from './internal.module.js';

const app = await NestFactory.create<NestExpressApplication>(InternalModule, { bufferLogs: true });
await configureHttpApp(app, 'internal');
await app.listen(app.get(ConfigService).getOrThrow<number>('INTERNAL_PORT'), '127.0.0.1');
