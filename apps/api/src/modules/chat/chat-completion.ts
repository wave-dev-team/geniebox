import { setTimeout as sleep } from 'node:timers/promises';

import type { Queue } from 'bullmq';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Optional } from '@nestjs/common';

import { type ChatJob, ChatRepository } from './chat.repository.js';
import { ChatModel, ModelError, type ModelMessage } from './chat-model.js';

export const chatQueue = 'chat-generate';
export const chatAttempts = 3;

export class DailyLimitError extends Error {}

export function canRetryModel(error: unknown) {
  return error instanceof ModelError && ['timeout', 'retryable'].includes(error.kind);
}

// A turn can make several model calls, so quota is acquired for each call across all workers.
const acquireSlot = `
  local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  if current >= tonumber(ARGV[1]) then
    return redis.call('PTTL', KEYS[1])
  end
  if redis.call('INCR', KEYS[1]) == 1 then redis.call('PEXPIRE', KEYS[1], 60000) end
  return 0
`;

@Injectable()
export class ChatCompletion {
  constructor(
    @Optional() @InjectQueue(chatQueue) private readonly queue: Queue<ChatJob> | undefined,
    private readonly repository: ChatRepository,
    private readonly model: ChatModel,
  ) {}

  async complete(
    job: ChatJob,
    options: {
      role: string;
      version: string;
      messages: ModelMessage[];
      onPartial?: (answer: string) => Promise<void>;
      responseSchema?: object;
      validate?: (answer: string) => boolean;
    },
  ) {
    if (!this.queue) throw new Error('Chat queue is disabled');
    const id = await this.repository.reserveCall(
      job,
      this.model.model,
      options.role,
      options.version,
      this.model.dailyLimit,
    );
    if (!id) throw new DailyLimitError();

    const client = await this.queue.getBackend().client;
    client.defineCommand('genieboxTakeModelSlot', { numberOfKeys: 1, lua: acquireSlot });
    for (;;) {
      const delay = Number(
        await client.runCommand('genieboxTakeModelSlot', [
          'geniebox:llm:calls-per-minute',
          this.model.callsPerMinute,
        ]),
      );
      if (delay <= 0) break;
      await sleep(delay);
    }

    const started = Date.now();
    let result: Awaited<ReturnType<ChatModel['generate']>>;
    try {
      result = await this.model.generate(options.messages, options.onPartial, options.responseSchema);
    } catch (error) {
      const status = error instanceof ModelError && error.kind === 'timeout' ? 'timeout' : 'error';
      await this.repository.recordCall(job, id, status, Date.now() - started);
      throw error;
    }
    const valid = options.validate?.(result.answer) ?? true;
    await this.repository.recordCall(job, id, valid ? 'ok' : 'invalid', Date.now() - started, result.usage);
    if (!valid) throw new ModelError('invalid');
    return result.answer;
  }
}
