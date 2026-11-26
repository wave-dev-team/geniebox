import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../../config/env.schema.js';
import { AccountDb, type AccountTx } from '../../../database/scoped-db.js';
import { JournalService } from '../../../journal/journal.service.js';
import { OutboxService } from '../../../outbox/outbox.service.js';
import { ScheduledTasksService } from '../../../scheduling/scheduled-tasks.service.js';
import { findTool, type PermissionMode, presetMode } from '../../agents/catalog/catalog.js';
import { CatalogService, versionMode } from '../../catalog/catalog.service.js';
import { type DecisionCreatedEvent, WORK_EVENTS } from '../../work/events/work.events.js';
import { DecisionsRepository } from '../../work/repositories/decisions.repository.js';
import type { RequestMode } from '../../work/work.constants.js';
import { RUNTIME_TASKS } from '../runtime.jobs.js';
import type { BrokerTool, ToolContext, ToolOutcome, ToolOutcomeStatus } from './broker.types.js';
import { KillSwitch } from './kill-switch.js';
import { ToolRegistry } from './tool-registry.js';

const STRICTNESS: PermissionMode[] = ['auto', 'notify', 'approve', 'deny'];
const stricter = (a: PermissionMode, b: PermissionMode) =>
  STRICTNESS.indexOf(a) >= STRICTNESS.indexOf(b) ? a : b;
const RESULT_LIMIT = 4_000;

export interface ExecuteOptions {
  /** A person approved this exact call (decision accepted). */
  approvedBy?: string | null;
  decisionId?: string | null;
}

/**
 * The only entry point for agent actions. Fixed order, no step skipped:
 * arguments → kill switch → policy and limits → idempotency → execution identity → execution
 * → journal. Every call ends up in `tool_calls`, whatever the outcome.
 */
@Injectable()
export class ToolExecutor {
  private readonly logger = new Logger(ToolExecutor.name);
  private readonly decisionTtlMs: number;

  constructor(
    private readonly accountDb: AccountDb,
    private readonly registry: ToolRegistry,
    private readonly catalog: CatalogService,
    private readonly killSwitch: KillSwitch,
    private readonly decisions: DecisionsRepository,
    private readonly journal: JournalService,
    private readonly scheduler: ScheduledTasksService,
    private readonly outbox: OutboxService,
    config: ConfigService<Env, true>,
  ) {
    this.decisionTtlMs = config.get('DECISION_TTL_DAYS', { infer: true }) * 24 * 60 * 60 * 1000;
  }

  async execute(
    context: ToolContext,
    toolId: string,
    rawArgs: string | Record<string, unknown>,
    offered: string[],
    options: ExecuteOptions = {},
  ): Promise<ToolOutcome> {
    const tool = this.registry.get(toolId);
    // 0. Only what this turn offered: an unknown or not-offered name is a refusal, not a guess.
    if (!tool || !offered.includes(toolId)) {
      return this.refuse(context, toolId, 'rejected', 'UNKNOWN_TOOL', {});
    }

    // 1. Arguments: strict zod schema, unknown fields refused.
    let input: unknown = rawArgs;
    if (typeof rawArgs === 'string') {
      try {
        input = rawArgs.trim() ? JSON.parse(rawArgs) : {};
      } catch {
        return this.refuse(context, toolId, 'rejected', 'INVALID_JSON', {});
      }
    }
    const parsed = tool.schema.safeParse(input);
    if (!parsed.success) {
      return this.refuse(
        context,
        toolId,
        'rejected',
        'INVALID_ARGUMENTS',
        {},
        {
          issues: parsed.error.issues.slice(0, 5).map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      );
    }
    const args = parsed.data;

    // 2. Kill switch for anything that changes the outside world.
    if (tool.mutating) {
      const state = await this.killSwitch.state(context.projectId, context.agent.id);
      if (state !== 'open') {
        return this.refuse(context, toolId, 'blocked', `KILL_SWITCH_${state.toUpperCase()}`, args);
      }
    }

    // 3. Policy: role, permissions, trust, request mode, «always ask», hard limits.
    const policy = await this.policy(context, tool, args);
    if (policy.mode === 'deny') {
      return this.refuse(context, toolId, 'denied', policy.reason, args);
    }
    const limitError = tool.limit?.(args, context.agent);
    if (limitError) return this.refuse(context, toolId, 'rejected', limitError, args);
    let connectionId: string | null = null;
    if (tool.providers?.length) {
      connectionId = await this.connectionFor(context.agent.id, tool.providers);
      if (!connectionId) return this.refuse(context, toolId, 'rejected', 'NO_CONNECTION', args);
    }
    if (policy.mode === 'approve' && !options.approvedBy) {
      return this.requestApproval(context, tool, args);
    }

    // 4. Idempotency: the same call of the same work returns its first result.
    const key = idempotencyKey(context, toolId, args, options.decisionId ?? null);
    const previous = await this.accountDb.transaction((tx) =>
      tx.db
        .selectFrom('tool_calls')
        .select(['status', 'result', 'error_code'])
        .where('idempotency_key', '=', key)
        .executeTakeFirst(),
    );
    if (previous?.status === 'executed') {
      return {
        status: 'executed',
        toolId,
        result: previous.result,
        terminal: tool.terminal ?? false,
      };
    }

    // 5–7. Execute under the agent's identity (journal actor) with the approval attached.
    if (tool.standalone) {
      try {
        const value = await tool.standalone(context, args);
        await this.accountDb.transaction((tx) =>
          this.write(tx, context, toolId, 'executed', policy.mode, args, key, {
            result: value,
            approvedBy: null,
            decisionId: null,
            connectionId: null,
          }),
        );
        return { status: 'executed', toolId, result: value, terminal: tool.terminal ?? false };
      } catch (error) {
        const code = error instanceof ToolError ? error.code : 'EXECUTION_FAILED';
        if (!(error instanceof ToolError)) {
          this.logger.error({ err: error, toolId }, 'Tool execution failed');
        }
        return this.refuse(context, toolId, 'failed', code, args);
      }
    }
    if (!tool.execute) return this.refuse(context, toolId, 'rejected', 'UNKNOWN_TOOL', args);
    const execute = tool.execute;
    try {
      const result = await this.accountDb.transaction(async (tx) => {
        const value = await execute(
          {
            ...context,
            tx,
            approvedBy: options.approvedBy ?? null,
            decisionId: options.decisionId ?? null,
            connectionId,
          },
          args,
        );
        await this.write(tx, context, toolId, 'executed', policy.mode, args, key, {
          result: value,
          approvedBy: options.approvedBy ?? null,
          decisionId: options.decisionId ?? null,
          connectionId,
        });
        return value;
      });
      return { status: 'executed', toolId, result, terminal: tool.terminal ?? false };
    } catch (error) {
      const code = error instanceof ToolError ? error.code : 'EXECUTION_FAILED';
      if (!(error instanceof ToolError)) {
        this.logger.error({ err: error, toolId }, 'Tool execution failed');
      }
      return this.refuse(context, toolId, 'failed', code, args);
    }
  }

  private async policy(
    context: ToolContext,
    tool: BrokerTool,
    args: Record<string, unknown>,
  ): Promise<{ mode: PermissionMode; reason: string }> {
    if (tool.kind === 'platform') {
      // Work inside Geniebox: no approval, but «только рекомендации» does not create work.
      if (context.mode === 'recommend_only' && tool.id === 'assign_task') {
        return { mode: 'deny', reason: 'RECOMMEND_ONLY' };
      }
      return { mode: 'auto', reason: '' };
    }
    const catalog = findTool(tool.id);
    if (!catalog || !this.registry.roleToolIds(context.agent).includes(tool.id)) {
      return { mode: 'deny', reason: 'NOT_IN_ROLE' };
    }
    if (catalog.systemDenied) return { mode: 'deny', reason: 'SYSTEM_DENIED' };
    const explicit = await this.accountDb.transaction((tx) =>
      tx.db
        .selectFrom('agent_permissions')
        .select('mode')
        .where('agent_id', '=', context.agent.id)
        .where('action_id', '=', tool.id)
        .executeTakeFirst(),
    );
    let mode =
      (explicit?.mode as PermissionMode | undefined) ??
      versionMode(this.catalog.forAgent(context.agent), tool.id, context.agent.trustLevel);
    if (mode === 'deny') return { mode, reason: 'PERMISSION_DENIED' };
    if (!tool.mutating) return { mode: mode === 'approve' ? 'notify' : mode, reason: '' };
    mode = stricter(mode, requestModeFloor(context.mode, catalog.risk));
    if (mode === 'deny') return { mode, reason: 'RECOMMEND_ONLY' };
    const ask = tool.askFor?.(args);
    if (
      ask &&
      (context.agent.asks.includes(ask) || (await this.projectAsks(context.projectId)).includes(ask))
    ) {
      mode = stricter(mode, 'approve');
    }
    return { mode, reason: '' };
  }

  private async projectAsks(projectId: string): Promise<string[]> {
    const row = await this.accountDb.transaction((tx) =>
      tx.db.selectFrom('projects').select('always_ask').where('id', '=', projectId).executeTakeFirst(),
    );
    return row?.always_ask ?? [];
  }

  private async connectionFor(agentId: string, providers: string[]): Promise<string | null> {
    const row = await this.accountDb.transaction((tx) =>
      tx.db
        .selectFrom('agent_connections')
        .innerJoin('connections', 'connections.id', 'agent_connections.connection_id')
        .select('connections.id')
        .where('agent_connections.agent_id', '=', agentId)
        .where('connections.provider_key', 'in', providers)
        .where('connections.deleted_at', 'is', null)
        .orderBy('connections.status')
        .executeTakeFirst(),
    );
    return row?.id ?? null;
  }

  /** Approval mode: the call becomes a pending decision with this exact action. */
  private async requestApproval(
    context: ToolContext,
    tool: BrokerTool,
    args: Record<string, unknown>,
  ): Promise<ToolOutcome> {
    const key = idempotencyKey(context, tool.id, args, 'approval');
    const decisionId = await this.accountDb.transaction(async (tx) => {
      const decision = await this.decisions.insert(tx.db, {
        account_id: tx.accountId,
        project_id: context.projectId,
        agent_id: context.agent.id,
        task_id: context.taskId,
        title: tool.title,
        risk: tool.risk,
        yes_label: 'Разрешить',
        pending_actions: [{ toolId: tool.id, args }],
        expires_at: new Date(Date.now() + this.decisionTtlMs),
      });
      await this.scheduler.schedule(tx, {
        type: RUNTIME_TASKS.DECISION_EXPIRE,
        payload: { decisionId: decision.id },
        runAt: decision.expires_at!,
        dedupeKey: decision.id,
      });
      await this.write(tx, context, tool.id, 'approval', 'approve', args, key, {
        decisionId: decision.id,
      });
      await this.outbox.add<DecisionCreatedEvent>(tx, {
        type: WORK_EVENTS.DECISION_CREATED,
        payload: { projectId: context.projectId, decisionId: decision.id },
      });
      return decision.id;
    });
    return { status: 'approval', toolId: tool.id, decisionId, terminal: true };
  }

  private async refuse(
    context: ToolContext,
    toolId: string,
    status: ToolOutcomeStatus,
    code: string,
    args: Record<string, unknown>,
    detail?: unknown,
  ): Promise<ToolOutcome> {
    try {
      await this.accountDb.transaction((tx) =>
        this.write(
          tx,
          context,
          /^[a-z][a-z0-9_.]{1,60}$/.test(toolId) ? toolId : 'unknown',
          status,
          null,
          args,
          `${idempotencyKey(context, toolId, args, null)}:${status}:${Date.now()}`,
          { errorCode: code },
        ),
      );
    } catch (error) {
      this.logger.error({ err: error, toolId }, 'tool_calls record failed');
    }
    return { status, toolId, errorCode: code, result: detail, terminal: false };
  }

  private async write(
    tx: AccountTx,
    context: ToolContext,
    toolId: string,
    status: ToolOutcomeStatus,
    mode: PermissionMode | null,
    args: Record<string, unknown>,
    key: string,
    extra: {
      result?: unknown;
      errorCode?: string;
      approvedBy?: string | null;
      decisionId?: string | null;
      connectionId?: string | null;
    },
  ): Promise<void> {
    const result = extra.result === undefined ? null : truncateJson(extra.result);
    await tx.db
      .insertInto('tool_calls')
      .values({
        account_id: tx.accountId,
        project_id: context.projectId,
        agent_id: context.agent.id,
        task_id: context.taskId,
        decision_id: extra.decisionId ?? null,
        connection_id: extra.connectionId ?? null,
        tool_id: toolId,
        args: JSON.stringify(args),
        mode,
        status,
        error_code: extra.errorCode ?? null,
        idempotency_key: key.slice(0, 120),
        approved_by: extra.approvedBy ?? null,
        result,
        trace_id: tx.traceId,
      })
      .onConflict((oc) => oc.columns(['account_id', 'idempotency_key']).doNothing())
      .execute();
    await this.journal.record(tx, {
      actor: { type: 'agent', id: context.agent.id },
      action: `tools.${toolId}`,
      target: context.taskId ? { type: 'task', id: context.taskId } : undefined,
      args: { mode, approvedBy: extra.approvedBy ?? null, decisionId: extra.decisionId ?? null },
      result: extra.errorCode ? { error: extra.errorCode } : { status },
      status:
        status === 'executed' || status === 'approval'
          ? 'succeeded'
          : status === 'failed'
            ? 'failed'
            : 'rejected',
    });
  }
}

/** Raised by tools for expected failures; the code goes back to the model. */
export class ToolError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Floor that the request mode puts on a mutating action of the given risk. */
function requestModeFloor(mode: RequestMode | null, risk: 'low' | 'medium' | 'high'): PermissionMode {
  switch (mode) {
    case 'recommend_only':
      return 'deny';
    case 'approve_all':
      return 'approve';
    case 'approve_important':
      return presetMode('approve_important', risk);
    default:
      return 'auto';
  }
}

function idempotencyKey(
  context: ToolContext,
  toolId: string,
  args: Record<string, unknown>,
  salt: string | null,
): string {
  const scope = context.taskId ?? context.replyMessageId ?? context.conversationId ?? 'none';
  const digest = createHash('sha256')
    .update(`${context.agent.id}|${scope}|${toolId}|${canonical(args)}|${salt ?? ''}`)
    .digest('hex');
  return `tc_${digest.slice(0, 48)}`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function truncateJson(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  return text.length <= RESULT_LIMIT ? text : JSON.stringify({ truncated: text.slice(0, RESULT_LIMIT) });
}
