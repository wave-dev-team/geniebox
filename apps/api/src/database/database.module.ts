import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';

import { createDb } from './create-db.js';
import { IdentityDirectory } from './identity-directory.js';
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
      provide: TenantDb,
      inject: [DATABASE, ClsService],
      useFactory: (db: ReturnType<typeof createDb>, context: ClsService<RequestContext>): TenantDb =>
        new TenantDb(db, context),
    },
  ],
  exports: [TenantDb, IdentityDirectory],
})
export class DatabaseModule {}
