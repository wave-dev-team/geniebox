import type { SelectQueryBuilder } from 'kysely';

import { Injectable } from '@nestjs/common';

import { AccountDb } from '../../database/scoped-db.js';
import type { DB } from '../../database/types.js';
import { ProjectContext } from '../projects/project-context.js';
import type { ActivityItemDto, ActivityPageDto, ActivityQueryDto } from './dto/summary.dto.js';

const PAGE = 50;
const CSV_LIMIT = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const RESULT_STATUSES = {
  ok: ['executed'],
  approval: ['approval'],
  refused: ['denied', 'rejected', 'blocked'],
  failed: ['failed'],
} as const;

interface Row {
  id: string;
  created_at: Date;
  agent_id: string;
  tool_id: string;
  args: unknown;
  result: unknown;
  mode: string | null;
  status: string;
  error_code: string | null;
  connection_id: string | null;
  task_id: string | null;
}

/**
 * Journal of agent actions: every broker call to a service — who, what, in which mode and
 * with which result. Built on `tool_calls`, which already holds masked arguments.
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly accountDb: AccountDb,
    private readonly projectContext: ProjectContext,
  ) {}

  async page(query: ActivityQueryDto): Promise<ActivityPageDto> {
    const rows = await this.rows(query, PAGE + 1);
    const items = rows.slice(0, PAGE).map(toItem);
    const last = rows.length > PAGE ? rows[PAGE - 1] : undefined;
    return { items, nextCursor: last ? encodeCursor(last) : null };
  }

  async csv(query: ActivityQueryDto): Promise<string> {
    const rows = await this.rows({ ...query, cursor: undefined }, CSV_LIMIT);
    const header = ['time', 'agent_id', 'tool', 'details', 'mode', 'status', 'error'];
    const lines = rows
      .map(toItem)
      .map((item) =>
        [item.at, item.agentId, item.toolId, item.details, item.mode ?? '', item.status, item.errorCode ?? '']
          .map(csvCell)
          .join(','),
      );
    return [header.join(','), ...lines].join('\n') + '\n';
  }

  private async rows(query: ActivityQueryDto, limit: number): Promise<Row[]> {
    const { projectId } = this.projectContext.actor();
    const days = query.period === '30d' ? 30 : query.period === '7d' ? 7 : 1;
    return this.accountDb.transaction(async (tx) => {
      let q: SelectQueryBuilder<DB, 'tool_calls', Row> = tx.db
        .selectFrom('tool_calls')
        .select([
          'id',
          'created_at',
          'agent_id',
          'tool_id',
          'args',
          'result',
          'mode',
          'status',
          'error_code',
          'connection_id',
          'task_id',
        ])
        .where('project_id', '=', projectId)
        // Calls to services only: catalog tools have a dotted id, Geniebox's own steps do not.
        .where('tool_id', 'like', '%.%')
        .where('created_at', '>', new Date(Date.now() - days * DAY_MS));
      if (query.agentId) q = q.where('agent_id', '=', query.agentId);
      if (query.connectionId) q = q.where('connection_id', '=', query.connectionId);
      if (query.result) q = q.where('status', 'in', [...RESULT_STATUSES[query.result]]);
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      if (cursor) {
        q = q.where((eb) =>
          eb.or([
            eb('created_at', '<', cursor.at),
            eb.and([eb('created_at', '=', cursor.at), eb('id', '<', cursor.id)]),
          ]),
        );
      }
      return q.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit).execute();
    });
  }
}

function toItem(row: Row): ActivityItemDto {
  return {
    id: row.id,
    at: row.created_at.toISOString(),
    agentId: row.agent_id,
    toolId: row.tool_id,
    details: details(row),
    mode: row.mode,
    status: row.status,
    errorCode: row.error_code,
    connectionId: row.connection_id,
    taskId: row.task_id,
  };
}

/** «days 7 · visits 1240»: a few scalar arguments and results, never nested data. */
export function details(row: Pick<Row, 'args' | 'result' | 'error_code'>): string {
  const scalars = (value: unknown, max: number): string[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
      .slice(0, max)
      .map(([k, v]) => `${k} ${String(v).slice(0, 40)}`);
  };
  const parts = [...scalars(row.args, 2), ...(row.error_code ? [row.error_code] : scalars(row.result, 2))];
  return parts.join(' · ').slice(0, 160);
}

function csvCell(value: string): string {
  // Leading = + - @ would run as a formula in spreadsheets.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function encodeCursor(row: Row): string {
  return Buffer.from(`${row.created_at.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: string } | null {
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const date = at ? new Date(at) : null;
  if (!date || Number.isNaN(date.getTime()) || !id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return { at: date, id };
}
