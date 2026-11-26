import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';

import { createDb } from './create-db.js';
import { DatabasePing } from './database-ping.js';
import { IdentityDirectory } from './identity-directory.js';
import { OutboxDirectory } from './outbox-directory.js';
import { RoutineDirectory } from './routine-directory.js';
import { type RequestContext, TenantDb } from './tenant-db.js';

const DATABASE = Symbol('DATABASE');

@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createDb(config.getOrThrow<string>('DATABASE_URL')),
    },
    {
      provide: IdentityDirectory,
      inject: [DATABASE],
      useFactory: (db: ReturnType<typeof createDb>) => new IdentityDirectory(db),
    },
    {
      provide: RoutineDirectory,
      inject: [DATABASE],
      useFactory: (db: ReturnType<typeof createDb>) => new RoutineDirectory(db),
    },
    {
      provide: OutboxDirectory,
      inject: [DATABASE],
      useFactory: (db: ReturnType<typeof createDb>) => new OutboxDirectory(db),
    },
    {
      provide: DatabasePing,
      inject: [DATABASE],
      useFactory: (db: ReturnType<typeof createDb>) => new DatabasePing(db),
    },
    {
      provide: TenantDb,
      inject: [DATABASE, ClsService],
      useFactory: (db: ReturnType<typeof createDb>, context: ClsService<RequestContext>): TenantDb =>
        new TenantDb(db, context),
    },
  ],
  exports: [TenantDb, IdentityDirectory, RoutineDirectory, OutboxDirectory, DatabasePing],
})
export class DatabaseModule {}
