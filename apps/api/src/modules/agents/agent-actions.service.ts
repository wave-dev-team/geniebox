import { Injectable } from '@nestjs/common';

import { AccountDb } from '../../database/scoped-db.js';
import { details as formatToolDetails } from '../metrics/activity.service.js';
import { ProjectContext } from '../projects/project-context.js';
import { AGENT_ERRORS, AgentException } from './agents.errors.js';
import type {
  AgentActionItemDto,
  AgentActionPageDto,
  AgentActionsQueryDto,
  AgentActionType,
} from './dto/agent.dto.js';
import { AgentsRepository } from './repositories/agents.repository.js';

const PAGE = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const ALL_TYPES: AgentActionType[] = ['tool', 'task', 'decision', 'insight', 'note', 'admin'];

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: string } | null {
  const [atRaw, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const at = atRaw ? new Date(atRaw) : null;
  if (!at || Number.isNaN(at.getTime()) || !id) return null;
  return { at, id };
}

function parseTypes(raw?: string): Set<AgentActionType> {
  if (!raw?.trim()) return new Set(ALL_TYPES);
  const requested = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is AgentActionType => (ALL_TYPES as string[]).includes(s));
  return requested.length > 0 ? new Set(requested) : new Set(ALL_TYPES);
}

/**
 * Unified timeline of an agent's actions for `/agents/[agentId]`.
 * Accessible to all project members (including `viewer`); tool call details are masked to scalars <= 160 chars.
 */
@Injectable()
export class AgentActionsService {
  constructor(
    private readonly accountDb: AccountDb,
    private readonly agents: AgentsRepository,
    private readonly projectContext: ProjectContext,
  ) {}

  async page(agentId: string, query: AgentActionsQueryDto): Promise<AgentActionPageDto> {
    const { projectId } = this.projectContext.actor();
    const days = query.period === '30d' ? 30 : 7;
    const since = new Date(Date.now() - days * DAY_MS);
    const types = parseTypes(query.types);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const fetchLimit = PAGE + 1;

    const items = await this.accountDb.transaction(async (tx) => {
      const agent = await this.agents.find(tx.db, projectId, agentId);
      if (!agent) throw new AgentException(AGENT_ERRORS.AGENT_NOT_FOUND);

      const merged: Array<AgentActionItemDto & { _at: Date }> = [];

      if (types.has('tool')) {
        let q = tx.db
          .selectFrom('tool_calls')
          .select([
            'id',
            'created_at',
            'tool_id',
            'args',
            'result',
            'status',
            'error_code',
            'connection_id',
            'task_id',
          ])
          .where('project_id', '=', projectId)
          .where('agent_id', '=', agentId)
          .where('tool_id', 'like', '%.%')
          .where('created_at', '>', since);
        if (cursor) q = q.where('created_at', '<=', cursor.at);
        const rows = await q.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(fetchLimit).execute();
        for (const r of rows) {
          merged.push({
            id: `tool:${r.id}`,
            type: 'tool',
            at: r.created_at.toISOString(),
            title: r.tool_id,
            details: formatToolDetails(r),
            status: r.status,
            targetId: r.connection_id,
            taskId: r.task_id,
            _at: r.created_at,
          });
        }
      }

      if (types.has('task')) {
        let q = tx.db
          .selectFrom('tasks')
          .select([
            'id',
            'title',
            'summary',
            'progress_text',
            'status',
            'finished_at',
            'started_at',
            'created_at',
          ])
          .where('project_id', '=', projectId)
          .where('agent_id', '=', agentId)
          .where('created_at', '>', since);
        if (cursor) q = q.where('created_at', '<=', cursor.at);
        const rows = await q.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(fetchLimit).execute();
        for (const r of rows) {
          const at = r.finished_at ?? r.started_at ?? r.created_at;
          merged.push({
            id: `task:${r.id}`,
            type: 'task',
            at: at.toISOString(),
            title: r.title,
            details: (r.progress_text ?? r.summary ?? '').slice(0, 160),
            status: r.status,
            targetId: r.id,
            taskId: r.id,
            _at: at,
          });
        }
      }

      if (types.has('decision')) {
        let q = tx.db
          .selectFrom('decisions')
          .select(['id', 'title', 'effect', 'meta', 'status', 'task_id', 'created_at'])
          .where('project_id', '=', projectId)
          .where('agent_id', '=', agentId)
          .where('created_at', '>', since);
        if (cursor) q = q.where('created_at', '<=', cursor.at);
        const rows = await q.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(fetchLimit).execute();
        for (const r of rows) {
          merged.push({
            id: `decision:${r.id}`,
            type: 'decision',
            at: r.created_at.toISOString(),
            title: r.title,
            details: (r.effect ?? r.meta ?? '').slice(0, 160),
            status: r.status,
            targetId: r.id,
            taskId: r.task_id,
            _at: r.created_at,
          });
        }
      }

      if (types.has('insight')) {
        let q = tx.db
          .selectFrom('insights')
          .select(['id', 'text', 'note', 'task_id', 'created_at'])
          .where('project_id', '=', projectId)
          .where('agent_id', '=', agentId)
          .where('created_at', '>', since);
        if (cursor) q = q.where('created_at', '<=', cursor.at);
        const rows = await q.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(fetchLimit).execute();
        for (const r of rows) {
          merged.push({
            id: `insight:${r.id}`,
            type: 'insight',
            at: r.created_at.toISOString(),
            title: r.text.slice(0, 120),
            details: (r.note ?? '').slice(0, 160),
            status: 'published',
            targetId: r.id,
            taskId: r.task_id,
            _at: r.created_at,
          });
        }
      }

      if (types.has('note')) {
        let q = tx.db
          .selectFrom('agent_notes')
          .select(['id', 'text', 'created_at'])
          .where('agent_id', '=', agentId)
          .where('created_at', '>', since);
        if (cursor) q = q.where('created_at', '<=', cursor.at);
        const rows = await q.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(fetchLimit).execute();
        for (const r of rows) {
          merged.push({
            id: `note:${r.id}`,
            type: 'note',
            at: r.created_at.toISOString(),
            title: 'Заметка агента',
            details: r.text.slice(0, 160),
            status: 'recorded',
            targetId: r.id,
            taskId: null,
            _at: r.created_at,
          });
        }
      }

      if (types.has('admin')) {
        let q = tx.db
          .selectFrom('action_journal')
          .select(['id', 'action', 'actor_role', 'status', 'occurred_at'])
          .where('target_type', '=', 'agent')
          .where('target_id', '=', agentId)
          .where('occurred_at', '>', since);
        if (cursor) q = q.where('occurred_at', '<=', cursor.at);
        const rows = await q.orderBy('occurred_at', 'desc').orderBy('id', 'desc').limit(fetchLimit).execute();
        for (const r of rows) {
          merged.push({
            id: `admin:${String(r.id)}`,
            type: 'admin',
            at: r.occurred_at.toISOString(),
            title: r.action,
            details: (r.actor_role ?? '').slice(0, 160),
            status: r.status,
            targetId: null,
            taskId: null,
            _at: r.occurred_at,
          });
        }
      }

      return merged;
    });

    const filtered = cursor
      ? items.filter(
          (item) =>
            item._at.getTime() < cursor.at.getTime() ||
            (item._at.getTime() === cursor.at.getTime() && item.id < cursor.id),
        )
      : items;

    filtered.sort((a, b) => {
      const diff = b._at.getTime() - a._at.getTime();
      if (diff !== 0) return diff;
      return b.id.localeCompare(a.id);
    });

    const pageItems = filtered.slice(0, PAGE);
    const hasMore = filtered.length > PAGE;
    const last = hasMore ? pageItems[pageItems.length - 1] : undefined;

    return {
      items: pageItems.map((entry) => {
        const rest = { ...entry } as Omit<typeof entry, '_at'> & { _at?: Date };
        delete rest._at;
        return rest;
      }),
      nextCursor: last ? encodeCursor(last._at, last.id) : null,
    };
  }
}
