import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { RedisModule } from './common/redis/redis.module.js';
import { CoreModule } from './core.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HttpCommonModule } from './http-common.module.js';
import { InternalHealthController } from './modules/health/internal-health.controller.js';

@Module({
  imports: [CoreModule, HttpCommonModule, DatabaseModule, RedisModule, TerminusModule],
  controllers: [InternalHealthController],
})
export class InternalModule {}
