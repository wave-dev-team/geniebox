import { Module } from '@nestjs/common';

import { RedisModule } from '../../common/redis/redis.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { ModelCallsRepository } from './model-calls.repository.js';
import { ModelProvider } from './model-provider.js';
import { RuntimeService } from './runtime.service.js';

@Module({
  imports: [RedisModule, DatabaseModule],
  providers: [RuntimeService, ModelProvider, ModelCallsRepository],
  exports: [RuntimeService],
})
export class RuntimeModule {}
