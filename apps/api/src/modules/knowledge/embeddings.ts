import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';

export interface EmbeddingResult {
  vectors: number[][];
  tokens: number;
}

export interface EmbeddingProvider {
  /** Stored next to every vector: a change of model means a reindex, never a mixed index. */
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<EmbeddingResult>;
}

export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

/** Deterministic, offline, no network: keeps dev and tests working without a key. */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'fake-embedding';

  constructor(readonly dimensions: number) {}

  embed(texts: string[]): Promise<EmbeddingResult> {
    const vectors = texts.map((text) => {
      const seed = createHash('sha256').update(text).digest();
      const vector = Array.from({ length: this.dimensions }, (_, index) => {
        const byte = seed[index % seed.length]!;
        return (byte / 255 - 0.5) * 2;
      });
      const norm = Math.hypot(...vector) || 1;
      return vector.map((value) => value / norm);
    });
    return Promise.resolve({ vectors, tokens: texts.reduce((sum, text) => sum + text.length / 4, 0) });
  }
}

interface OpenAiEmbeddingResponse {
  data?: Array<{ embedding: number[]; index: number }>;
  usage?: { prompt_tokens?: number };
}

/** OpenAI embeddings in batches of 64; retries a transient failure twice. */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  private readonly logger = new Logger(OpenAiEmbeddingProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    model: string,
    readonly dimensions: number,
  ) {
    this.model = model;
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const vectors: number[][] = [];
    let tokens = 0;
    for (let start = 0; start < texts.length; start += 64) {
      const batch = texts.slice(start, start + 64);
      const result = await this.request(batch);
      vectors.push(...result.vectors);
      tokens += result.tokens;
    }
    return { vectors, tokens: Math.ceil(tokens) };
  }

  private async request(batch: string[]): Promise<EmbeddingResult> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            input: batch,
            dimensions: this.dimensions,
            encoding_format: 'float',
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          if (response.status >= 500 && attempt < 2) continue;
          throw new Error(`embeddings HTTP ${response.status}`);
        }
        const body = (await response.json()) as OpenAiEmbeddingResponse;
        const data = (body.data ?? []).sort((a, b) => a.index - b.index);
        if (data.length !== batch.length) throw new Error('embeddings response is incomplete');
        return { vectors: data.map((item) => item.embedding), tokens: body.usage?.prompt_tokens ?? 0 };
      } catch (error) {
        if (attempt >= 2) {
          this.logger.warn({ err: error }, 'embedding request failed');
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
  }
}

/** `none` keeps search on full-text only; the index never blocks on a provider. */
@Injectable()
export class EmbeddingsService {
  constructor(
    @Inject(EMBEDDING_PROVIDER) private readonly provider: EmbeddingProvider | null,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get enabled(): boolean {
    return this.provider !== null;
  }

  get model(): string | null {
    return this.provider?.model ?? null;
  }

  embed(texts: string[]): Promise<EmbeddingResult> {
    if (!this.provider) return Promise.resolve({ vectors: [], tokens: 0 });
    return this.provider.embed(texts);
  }

  /** Cost of the tokens spent on a project, kept for the economics of one request. */
  costPerMillion(): number {
    return this.config.get('EMBEDDING_PRICE_PER_MTOK', { infer: true });
  }
}

export function embeddingProviderFactory(config: ConfigService<Env, true>): EmbeddingProvider | null {
  const kind = config.get('EMBEDDING_PROVIDER', { infer: true });
  const dimensions = config.get('EMBEDDING_DIMENSIONS', { infer: true });
  if (kind === 'none') return null;
  if (kind === 'fake') return new FakeEmbeddingProvider(dimensions);
  const key =
    config.get('EMBEDDING_API_KEY', { infer: true }) ?? config.get('OPENAI_API_KEY', { infer: true });
  if (!key) return null;
  return new OpenAiEmbeddingProvider(
    key,
    config.get('EMBEDDING_BASE_URL', { infer: true }),
    config.get('EMBEDDING_MODEL', { infer: true }),
    dimensions,
  );
}

export const embeddingProvider = {
  provide: EMBEDDING_PROVIDER,
  inject: [ConfigService],
  useFactory: embeddingProviderFactory,
};
