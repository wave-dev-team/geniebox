import { Redis } from 'ioredis';

import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';

import { STATE_REDIS } from '../../common/redis/redis.module.js';
import { type ProjectStreamEvent, STREAM_CHANNEL_PATTERN } from './stream.events.js';

type Listener = (event: ProjectStreamEvent) => void;

/**
 * One Redis subscription per API process, fanned out to the open SSE connections of each
 * project. Subscribes lazily on the first listener.
 */
@Injectable()
export class StreamHub implements OnApplicationShutdown {
  private readonly logger = new Logger(StreamHub.name);
  private readonly listeners = new Map<string, Set<Listener>>();
  private subscriber: Redis | undefined;

  constructor(@Inject(STATE_REDIS) private readonly redis: Redis) {}

  subscribe(projectId: string, listener: Listener): () => void {
    this.ensureSubscribed();
    let set = this.listeners.get(projectId);
    if (!set) {
      set = new Set();
      this.listeners.set(projectId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(projectId);
    };
  }

  private ensureSubscribed(): void {
    if (this.subscriber) return;
    const subscriber = this.redis.duplicate({ connectionName: 'geniebox:stream' });
    this.subscriber = subscriber;
    subscriber.on('pmessage', (_pattern: string, channel: string, raw: string) => {
      const projectId = channel.slice(channel.lastIndexOf(':') + 1);
      const set = this.listeners.get(projectId);
      if (!set) return;
      let event: ProjectStreamEvent;
      try {
        event = JSON.parse(raw) as ProjectStreamEvent;
      } catch {
        return;
      }
      for (const listener of set) listener(event);
    });
    subscriber.psubscribe(STREAM_CHANNEL_PATTERN).catch((error: unknown) => {
      this.logger.error({ err: error }, 'Stream subscription failed');
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.subscriber?.quit();
  }
}
