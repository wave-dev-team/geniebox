import helmet from 'helmet';

import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import { createValidationPipe } from '../common/validation/validation.pipe.js';
import type { Env } from '../config/env.schema.js';

export interface HttpAppOptions {
  kind: 'public' | 'internal';
}

export function configureHttpApp(app: NestExpressApplication, options: HttpAppOptions): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useBodyParser('json', { limit: '32mb' });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.disable('x-powered-by');
  app.use(helmet());
  app.useGlobalPipes(createValidationPipe());
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  if (options.kind === 'public') {
    app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
    const origins = config.get('CORS_ORIGINS', { infer: true });
    app.enableCors({ origin: origins.length > 0 ? origins : false, credentials: false });

    if (config.get('SWAGGER_ENABLED', { infer: true })) {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Geniebox API').setVersion('1').addBearerAuth().build(),
      );
      SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' });
    }
  }
}
