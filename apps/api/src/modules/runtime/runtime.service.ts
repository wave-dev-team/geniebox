import { setTimeout as sleep } from 'node:timers/promises';

import { Injectable } from '@nestjs/common';

import { AppRedis } from '../../common/redis/app-redis.js';
import { type ModelCallSource, ModelCallsRepository } from './model-calls.repository.js';
import { ModelError, type ModelMessage, ModelProvider } from './model-provider.js';

export const modelAttempts = 3;

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
export class RuntimeService {
  constructor(
    private readonly redis: AppRedis,
    private readonly repository: ModelCallsRepository,
    private readonly model: ModelProvider,
  ) {}

  get enabled() {
    return this.model.enabled;
  }

  async complete(
    job: ModelCallSource,
    options: {
      role: string;
      version: string;
      messages: ModelMessage[];
      onPartial?: (answer: string) => Promise<void>;
      responseSchema?: object;
      validate?: (answer: string) => boolean;
    },
  ) {
    if (!this.enabled) throw new Error('Runtime is disabled');
    const id = await this.repository.reserveCall(
      job,
      this.model.model,
      options.role,
      options.version,
      this.model.dailyLimit,
    );
    if (!id) throw new DailyLimitError();

    const client = this.redis.client;
    for (;;) {
      const delay = Number(
        await client.eval(acquireSlot, 1, 'geniebox:llm:calls-per-minute', this.model.callsPerMinute),
      );
      if (delay <= 0) break;
      await sleep(delay);
    }

    const started = Date.now();
    let result: Awaited<ReturnType<ModelProvider['generate']>>;
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
