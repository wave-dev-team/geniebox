import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { Response } from 'express';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule, ClsServiceManager } from 'nestjs-cls';
import { AcceptLanguageResolver, I18nModule } from 'nestjs-i18n';
import { LoggerModule } from 'nestjs-pino';

import { JwtGuard } from './common/auth/jwt.guard.js';
import { SameOriginGuard } from './common/auth/same-origin.guard.js';
import { appEnvironment } from './config/environment.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';

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
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    AuthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: SameOriginGuard },
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
