import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { Response } from 'express';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule, ClsServiceManager } from 'nestjs-cls';
import { AcceptLanguageResolver, I18nModule } from 'nestjs-i18n';
import { LoggerModule } from 'nestjs-pino';

import { JwtGuard } from './common/auth/jwt.guard.js';
import { SameOriginGuard } from './common/auth/same-origin.guard.js';
import { appEnvironment } from './config/environment.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { ActionsModule } from './modules/actions/actions.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { ConnectionsModule } from './modules/connections/connections.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { StreamModule } from './modules/stream/stream.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';

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
    EventEmitterModule.forRoot(),
    AuthModule,
    AccountsModule,
    ActionsModule,
    ChatModule,
    ConnectionsModule,
    ReportsModule,
    TasksModule,
    StreamModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: SameOriginGuard },
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
