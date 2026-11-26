import { Module } from '@nestjs/common';

import { AppRedis } from './app-redis.js';

@Module({ providers: [AppRedis], exports: [AppRedis] })
export class RedisModule {}
