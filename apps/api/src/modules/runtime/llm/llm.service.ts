import { sql } from 'kysely';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../../common/context/app-cls-store.js';
import type { Env } from '../../../config/env.schema.js';
import { AccountDb } from '../../../database/scoped-db.js';
import {
  LLM_PROVIDER,
  LlmFatalError,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  LlmTransientError,
} from './llm.types.js';

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 1_000;

export interface LlmCallContext {
  projectId: string;
  agentId: string | null;
  taskId?: string | null;
  conversationId?: string | null;
  /** Prompt role, e.g. `manager.turn`, `agent.task`. */
  role: string;
  promptVersion: string;
  /** Catalog model purpose: `fast` → LLM_MODEL_FAST, otherwise LLM_MODEL. */
  model?: 'reasoning' | 'fast';
  /** Monthly limits in roubles: the project's AI budget and the agent's own limit. */
  projectBudgetRub: number;
  agentBudgetRub: number | null;
}

export class LlmBudgetExceededError extends Error {
  constructor(readonly scope: 'project' | 'agent') {
    super(`AI budget of the ${scope} is exhausted`);
  }
}

/**
 * The only way to call a model: budget checked before the call, timeout,
 * rate limit, retries on 429/5xx/timeout with backoff, every call recorded in `llm_calls`.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly model: string;
  private readonly fastModel: string;
  private readonly priceIn: number;
  private readonly priceOut: number;
  private readonly rubPerUsd: number;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly minIntervalMs: number;
  private nextSlot = 0;

  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    private readonly accountDb: AccountDb,
    private readonly cls: ClsService<AppClsStore>,
    config: ConfigService<Env, true>,
  ) {
    this.model = config.get('LLM_MODEL', { infer: true });
    this.fastModel = config.get('LLM_MODEL_FAST', { infer: true }) ?? this.model;
    this.priceIn = config.get('LLM_PRICE_IN_PER_MTOK', { infer: true });
    this.priceOut = config.get('LLM_PRICE_OUT_PER_MTOK', { infer: true });
    this.rubPerUsd = config.get('USD_RUB_RATE', { infer: true }) * config.get('LLM_MARKUP', { infer: true });
    this.timeoutMs = config.get('LLM_TIMEOUT_MS', { infer: true });
    this.maxTokens = config.get('LLM_MAX_TOKENS', { infer: true });
    this.minIntervalMs = Math.ceil(1000 / config.get('LLM_RATE_PER_SEC', { infer: true }));
  }

  async complete(
    context: LlmCallContext,
    request: Pick<LlmRequest, 'messages' | 'tools' | 'onTextDelta'>,
  ): Promise<LlmResponse> {
    await this.assertBudget(context);
    let streamed = false;
    const full: LlmRequest = {
      ...request,
      role: context.role,
      model: context.model === 'fast' ? this.fastModel : this.model,
      maxTokens: this.maxTokens,
      timeoutMs: this.timeoutMs,
      onTextDelta: request.onTextDelta
        ? (delta) => {
            streamed = true;
            request.onTextDelta?.(delta);
          }
        : undefined,
    };
    for (let attempt = 1; ; attempt++) {
      await this.waitForSlot();
      const started = Date.now();
      try {
        const response = await this.provider.complete(full);
        await this.record(context, started, 'ok', null, response.usage);
        return response;
      } catch (error) {
        const transient = error instanceof LlmTransientError;
        const code = transient || error instanceof LlmFatalError ? error.code : 'unknown';
        await this.record(context, started, code === 'timeout' ? 'timeout' : 'error', code, null);
        // A partly streamed answer is not repeated: the user already saw its beginning.
        if (!transient || streamed || attempt >= MAX_ATTEMPTS) throw error;
        await sleep(BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
  }

  /** Records a model answer that failed validation. */
  async recordInvalid(context: LlmCallContext, code: string): Promise<void> {
    await this.record(context, Date.now(), 'invalid', code, null);
  }

  private async assertBudget(context: LlmCallContext): Promise<void> {
    const monthStart = sql<Date>`date_trunc('month', now())`;
    const spent = await this.accountDb.transaction(async (tx) => {
      const project = await tx.db
        .selectFrom('llm_calls')
        .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('cost_rub'), sql<string>`0`).as('sum'))
        .where('project_id', '=', context.projectId)
        .where('created_at', '>=', monthStart)
        .executeTakeFirstOrThrow();
      const agent = context.agentId
        ? await tx.db
            .selectFrom('llm_calls')
            .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('cost_rub'), sql<string>`0`).as('sum'))
            .where('agent_id', '=', context.agentId)
            .where('created_at', '>=', monthStart)
            .executeTakeFirstOrThrow()
        : { sum: '0' };
      return { project: Number(project.sum), agent: Number(agent.sum) };
    });
    const scope =
      spent.project >= context.projectBudgetRub
        ? 'project'
        : context.agentBudgetRub !== null && spent.agent >= context.agentBudgetRub
          ? 'agent'
          : null;
    if (scope) {
      await this.record(context, Date.now(), 'budget', `budget_${scope}`, null);
      throw new LlmBudgetExceededError(scope);
    }
  }

  private async waitForSlot(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.minIntervalMs;
    if (slot > now) await sleep(slot - now);
  }

  private async record(
    context: LlmCallContext,
    started: number,
    result: 'ok' | 'error' | 'timeout' | 'invalid' | 'budget',
    errorCode: string | null,
    usage: { tokensIn: number; tokensOut: number } | null,
  ): Promise<void> {
    const tokensIn = usage?.tokensIn ?? 0;
    const tokensOut = usage?.tokensOut ?? 0;
    const costUsd = (tokensIn * this.priceIn + tokensOut * this.priceOut) / 1_000_000;
    try {
      await this.accountDb.transaction(async (tx) => {
        await tx.db
          .insertInto('llm_calls')
          .values({
            account_id: tx.accountId,
            project_id: context.projectId,
            agent_id: context.agentId,
            task_id: context.taskId ?? null,
            conversation_id: context.conversationId ?? null,
            role: context.role,
            provider: this.provider.name,
            model: context.model === 'fast' ? this.fastModel : this.model,
            prompt_version: context.promptVersion,
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            cost_usd: costUsd.toFixed(6),
            cost_rub: (costUsd * this.rubPerUsd).toFixed(2),
            latency_ms: Date.now() - started,
            result,
            error_code: errorCode,
            trace_id: this.cls.getId() ?? null,
          })
          .execute();
      });
    } catch (error) {
      this.logger.error({ err: error, role: context.role }, 'llm_calls record failed');
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
