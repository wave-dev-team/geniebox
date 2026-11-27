import type { Redis } from 'ioredis';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { STATE_REDIS } from '../../common/redis/redis.module.js';
import { type ProjectStreamEvent, streamChannel } from './stream.events.js';

/**
 * Publishes live events through Redis pub/sub. Delivery is best effort: the stream is a hint
 * to refetch, never the only copy of anything.
 */
@Injectable()
export class StreamPublisher {
  private readonly logger = new Logger(StreamPublisher.name);

  constructor(@Inject(STATE_REDIS) private readonly redis: Redis) {}

  async publish(projectId: string, event: ProjectStreamEvent): Promise<void> {
    try {
      await this.redis.publish(streamChannel(projectId), JSON.stringify(event));
    } catch (error) {
      this.logger.warn({ err: error, projectId, type: event.type }, 'Stream publish failed');
    }
  }
}
