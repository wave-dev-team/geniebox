import { Module } from '@nestjs/common';

import { RedisModule } from '../../common/redis/redis.module.js';
import { StreamController } from './stream.controller.js';
import { StreamService } from './stream.service.js';

@Module({ imports: [RedisModule], controllers: [StreamController], providers: [StreamService] })
export class StreamModule {}
