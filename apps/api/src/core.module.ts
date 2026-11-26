import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { Response } from 'express';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ClsModule, ClsServiceManager } from 'nestjs-cls';
import { AcceptLanguageResolver, I18nModule } from 'nestjs-i18n';
import { LoggerModule } from 'nestjs-pino';

import { appEnvironment } from './config/environment.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (env) => appEnvironment.parse(env) }),
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: () => randomUUID(),
        setup: (context, _request, response: Response) => {
          response.setHeader('X-Request-Id', context.getId());
        },
      },
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        quietReqLogger: true,
        serializers: {
          req: () => undefined,
          res: (response: Pick<Response, 'statusCode'>) => ({ statusCode: response.statusCode }),
        },
        customProps: () => {
          const context = ClsServiceManager.getClsService();
          return { traceId: context.getId(), tenantId: context.get('tenantId') };
        },
      },
    }),
    I18nModule.forRoot({
      fallbackLanguage: 'ru',
      loaderOptions: { path: fileURLToPath(new URL('./i18n', import.meta.url)) },
      resolvers: [AcceptLanguageResolver],
    }),
    EventEmitterModule.forRoot(),
  ],
  exports: [LoggerModule],
})
export class CoreModule {}
