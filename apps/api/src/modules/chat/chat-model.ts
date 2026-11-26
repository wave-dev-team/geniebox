import { z } from 'zod';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppEnvironment } from '../../config/environment.js';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const chunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z.object({ content: z.string().nullish() }).optional(),
        finish_reason: z.string().nullish(),
      }),
    )
    .default([]),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .nullish(),
  error: z.unknown().optional(),
});

export class ModelError extends Error {
  constructor(readonly kind: 'timeout' | 'retryable' | 'rejected' | 'invalid') {
    super(kind);
  }
}

@Injectable()
export class ChatModel {
  private readonly baseUrl;
  private readonly apiKey;
  private readonly timeout;
  private readonly maxTokens;
  private readonly priceIn;
  private readonly priceOut;
  readonly model;
  readonly dailyLimit;
  readonly callsPerMinute;

  constructor(config: ConfigService<AppEnvironment, true>) {
    this.baseUrl = config.get('LLM_BASE_URL', { infer: true });
    this.apiKey = config.get('LLM_API_KEY', { infer: true });
    this.timeout = config.get('LLM_TIMEOUT_MS', { infer: true });
    this.maxTokens = config.get('LLM_MAX_OUTPUT_TOKENS', { infer: true });
    this.priceIn = config.get('LLM_INPUT_USD_PER_MTOK', { infer: true });
    this.priceOut = config.get('LLM_OUTPUT_USD_PER_MTOK', { infer: true });
    this.model = config.get('LLM_MODEL', { infer: true });
    this.dailyLimit = config.get('LLM_DAILY_CALL_LIMIT', { infer: true });
    this.callsPerMinute = config.get('LLM_CALLS_PER_MINUTE', { infer: true });
  }

  get enabled() {
    return Boolean(this.baseUrl);
  }

  async generate(
    messages: ModelMessage[],
    onPartial?: (text: string) => Promise<void>,
    responseSchema?: object,
  ) {
    if (!this.baseUrl) throw new ModelError('rejected');
    const signal = AbortSignal.timeout(this.timeout);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_completion_tokens: this.maxTokens,
          ...(responseSchema && {
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'agent_selection', strict: true, schema: responseSchema },
            },
          }),
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal,
      });
    } catch {
      throw new ModelError(signal.aborted ? 'timeout' : 'rejected');
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw new ModelError(response.status === 429 || response.status >= 500 ? 'retryable' : 'rejected');
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    let answer = '';
    let lastUpdate = 0;
    let finished = false;
    let usage: z.infer<typeof chunkSchema>['usage'];
    try {
      while (!finished) {
        const { value, done } = await reader.read().catch(() => {
          throw new ModelError(signal.aborted ? 'timeout' : 'rejected');
        });
        if (done) break;
        buffer += value;
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') {
            finished = true;
            break;
          }
          const chunk = chunkSchema.safeParse(parseJson(payload));
          if (!chunk.success || chunk.data.error) throw new ModelError('invalid');
          if (chunk.data.usage) usage = chunk.data.usage;
          const text = chunk.data.choices[0]?.delta?.content;
          if (!text) continue;
          answer += text.replaceAll('\u0000', '');
          if (answer.length > 32_000) throw new ModelError('invalid');
          if (onPartial && Date.now() - lastUpdate >= 600 && answer.trim()) {
            await onPartial(answer);
            lastUpdate = Date.now();
          }
        }
        if (buffer.length > 128_000) throw new ModelError('invalid');
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    if (!finished || !answer.trim()) throw new ModelError('invalid');
    return {
      answer: answer.trim(),
      usage: usage
        ? {
            input: usage.prompt_tokens,
            output: usage.completion_tokens,
            cost: (
              (usage.prompt_tokens * this.priceIn + usage.completion_tokens * this.priceOut) /
              1_000_000
            ).toFixed(8),
          }
        : undefined,
    };
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
