import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';

import { createDb } from './create-db.js';
import { type RequestContext, TenantDb } from './tenant-db.js';

@Module({
  providers: [
    {
      provide: TenantDb,
      inject: [ConfigService, ClsService],
      useFactory: (config: ConfigService, context: ClsService<RequestContext>): TenantDb =>
        new TenantDb(createDb(config.getOrThrow<string>('DATABASE_URL')), context),
    },
  ],
  exports: [TenantDb],
})
export class DatabaseModule {}
