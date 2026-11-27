import type { Kysely } from 'kysely';

import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.schema.js';
import { createKysely } from './create-kysely.js';
import { APP_KYSELY, SYSTEM_KYSELY } from './database.tokens.js';
import { DatabasePing } from './database-ping.js';
import { AccountDb, SCOPED_DB_PROVIDERS, UserDb } from './scoped-db.js';
import { SystemDb } from './system-db.js';
import type { DB } from './types.js';

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  private readonly logger = new Logger('Database');

  constructor(
    @Inject(APP_KYSELY) private readonly app: Kysely<DB>,
    @Inject(SYSTEM_KYSELY) private readonly system: Kysely<DB>,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.app.destroy(), this.system.destroy()]);
    this.logger.log('Database pools closed');
  }
}

@Global()
@Module({
  providers: [
    {
      provide: APP_KYSELY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Kysely<DB> =>
        createKysely<DB>({
          connectionString: config.get('DATABASE_URL', { infer: true }),
          max: config.get('DATABASE_POOL_MAX', { infer: true }),
          applicationName: 'geniebox:app',
        }),
    },
    {
      provide: SYSTEM_KYSELY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Kysely<DB> =>
        createKysely<DB>({
          connectionString: config.get('DATABASE_SYSTEM_URL', { infer: true }),
          max: 4,
          applicationName: 'geniebox:system',
        }),
    },
    ...SCOPED_DB_PROVIDERS,
    SystemDb,
    DatabasePing,
    DatabaseLifecycle,
  ],
  exports: [AccountDb, UserDb, SystemDb, DatabasePing],
})
export class DatabaseModule {}
