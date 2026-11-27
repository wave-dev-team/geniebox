import type { Redis } from 'ioredis';

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { STATE_REDIS } from './common/redis/redis.module.js';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage.js';
import { isStrictThrottled, STRICT_THROTTLER } from './common/throttler/strict-throttle.decorator.js';
import type { Env } from './config/env.schema.js';
import { CoreModule } from './core.module.js';
import { HttpCommonModule } from './http-common.module.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { ActionsApiModule } from './modules/actions/actions.module.js';
import { AgentsModule } from './modules/agents/agents.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AccessTokenGuard } from './modules/auth/guards/access-token.guard.js';
import { ConnectionsModule } from './modules/connections/connections.module.js';
import { PublicHealthModule } from './modules/health/health.module.js';
import { KnowledgeModule } from './modules/knowledge/knowledge.module.js';
import { MailModule } from './modules/mail/mail.module.js';
import { MetricsModule } from './modules/metrics/metrics.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { DemoSandboxModule } from './modules/sandbox/sandbox.module.js';
import { StreamModule, StreamPublisherModule } from './modules/stream/stream.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { WorkModule } from './modules/work/work.module.js';
import { QueueRootModule } from './queues/queue-root.module.js';

/** Public API process: listens on PUBLIC_HOST, sits behind the reverse proxy. */
@Module({
  imports: [
    CoreModule,
    HttpCommonModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, STATE_REDIS],
      useFactory: (config: ConfigService<Env, true>, redis: Redis) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get('THROTTLE_TTL_MS', { infer: true }),
            limit: config.get('THROTTLE_LIMIT', { infer: true }),
          },
          {
            name: STRICT_THROTTLER,
            ttl: 60_000,
            limit: config.get('AUTH_THROTTLE_LIMIT', { infer: true }),
            skipIf: (context) => !isStrictThrottled(context),
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    QueueRootModule,
    MailModule,
    PublicHealthModule,
    AuthModule,
    UsersModule,
    AccountsModule,
    ProjectsModule,
    DemoSandboxModule,
    ConnectionsModule,
    AgentsModule,
    StreamPublisherModule,
    StreamModule,
    WorkModule,
    MetricsModule,
    KnowledgeModule,
    ActionsApiModule,
  ],
  // Order matters: throttle first, then authenticate.
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AccessTokenGuard },
  ],
})
export class ApiModule {}
