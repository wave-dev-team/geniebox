import { Module } from '@nestjs/common';

import { RedisModule } from '../../common/redis/redis.module.js';
import { StreamController } from './stream.controller.js';
import { StreamService } from './stream.service.js';

@Module({ imports: [RedisModule], providers: [StreamService], exports: [StreamService] })
export class StreamPublisherModule {}

@Module({ imports: [StreamPublisherModule], controllers: [StreamController] })
export class StreamModule {}
