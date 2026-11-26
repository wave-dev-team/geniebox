import { EventEmitter } from 'node:events';

import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { AppRedis } from '../../common/redis/app-redis.js';

interface Recipient {
  tenantId: string;
  userId: string;
}

type Topic = 'chat' | 'tasks' | 'work';

const namespace = 'geniebox:stream:';

function channel(recipient: Recipient) {
  return `${namespace}${recipient.tenantId}:${recipient.userId}`;
}

@Injectable()
export class StreamService implements OnModuleDestroy {
  private readonly logger = new Logger(StreamService.name);
  private readonly listeners = new EventEmitter().setMaxListeners(0);
  private readonly subscriber;
  private subscription?: Promise<void>;

  constructor(private readonly redis: AppRedis) {
    this.subscriber = redis.client.duplicate({ connectionName: 'geniebox-stream' });
    this.subscriber.on('error', () => this.logger.warn('Event stream subscriber unavailable'));
    this.subscriber.on('pmessage', (_pattern, key, message) => {
      if (message === 'chat' || message === 'tasks' || message === 'work') {
        this.listeners.emit(key, message);
      }
    });
  }

  onModuleDestroy() {
    this.subscriber.disconnect();
  }

  subscribe(recipient: Recipient, notify: (topic: Topic) => void) {
    const key = channel(recipient);
    this.listeners.on(key, notify);
    this.subscription ??= this.subscriber
      .psubscribe(`${namespace}*`)
      .then(() => undefined)
      .catch((error: unknown) => {
        this.subscription = undefined;
        throw error;
      });
    return {
      ready: this.subscription,
      unsubscribe: () => this.listeners.off(key, notify),
    };
  }

  @OnEvent('chat.turn_submitted')
  @OnEvent('chat.turn_partial')
  @OnEvent('chat.turn_completed')
  @OnEvent('chat.turn_failed')
  @OnEvent('chat.turn_limited')
  chatChanged(recipient: Recipient) {
    return this.publish(recipient, 'chat');
  }

  @OnEvent('task.created')
  @OnEvent('task.updated')
  @OnEvent('task.started')
  @OnEvent('task.completed')
  @OnEvent('task.failed')
  @OnEvent('task.cancelled')
  @OnEvent('task.requeued')
  tasksChanged(recipient: Recipient) {
    return this.publish(recipient, 'tasks');
  }

  @OnEvent('agent.task_assigned')
  @OnEvent('agent.task_started')
  @OnEvent('agent.task_completed')
  @OnEvent('agent.task_failed')
  delegationChanged(recipient: Recipient) {
    return this.publish(recipient, 'work');
  }

  private async publish(recipient: Recipient, topic: Topic) {
    try {
      await this.redis.client.publish(channel(recipient), topic);
    } catch {
      this.logger.warn('Event stream publication failed');
    }
  }
}
