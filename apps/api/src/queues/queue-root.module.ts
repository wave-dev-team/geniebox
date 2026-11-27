import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.schema.js';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url: string = config.get('REDIS_STATE_URL', { infer: true });
        return {
          connection: {
            url,
            // Required by BullMQ workers: blocking commands must not be retried by the client.
            maxRetriesPerRequest: null,
          },
          prefix: 'geniebox',
        };
      },
    }),
  ],
})
export class QueueRootModule {}
