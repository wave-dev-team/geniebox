import helmet from 'helmet';

import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { HttpExceptionFilter } from '../common/filters/http-exception.filter.js';

export async function configureHttpApp(app: NestExpressApplication, prefix = 'api') {
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.setGlobalPrefix(prefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(await app.resolve(HttpExceptionFilter));
}
