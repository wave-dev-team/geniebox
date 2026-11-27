import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { ContextModule } from './common/context/context.module.js';
import { AppI18nModule } from './common/i18n/i18n.module.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { RedisModule } from './common/redis/redis.module.js';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { JournalModule } from './journal/journal.service.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { SchedulingModule } from './scheduling/scheduling.module.js';

/** Infrastructure shared by every process (public API, internal API, worker). */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    ContextModule,
    LoggingModule,
    AppI18nModule,
    DatabaseModule,
    RedisModule,
    EventEmitterModule.forRoot({ wildcard: false, ignoreErrors: false }),
    OutboxModule,
    JournalModule,
    SchedulingModule,
    CatalogModule,
  ],
})
export class CoreModule {}
