import helmet from 'helmet';

import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { HttpExceptionFilter } from '../common/filters/http-exception.filter.js';
import { createValidationPipe } from '../common/validation/validation.pipe.js';

export async function configureHttpApp(app: NestExpressApplication, prefix = 'api') {
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.setGlobalPrefix(prefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(await app.resolve(HttpExceptionFilter));
}
