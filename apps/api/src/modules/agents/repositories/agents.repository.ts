import type { Insertable, Selectable, Transaction, Updateable } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { Agents, DB } from '../../../database/types.js';
import type { LimitValue } from '../catalog/catalog.js';

export interface Instruction {
  topic: string;
  rule: string;
}

export type AgentRow = Omit<Selectable<Agents>, 'instructions' | 'limits'> & {
  instructions: Instruction[];
  limits: Record<string, LimitValue>;
};
export type AgentInsert = Omit<Insertable<Agents>, 'instructions' | 'limits'> & {
  instructions?: Instruction[];
  limits?: Record<string, LimitValue>;
};
export type AgentUpdate = Omit<
  Updateable<Agents>,
  'id' | 'account_id' | 'project_id' | 'kind' | 'created_at' | 'instructions' | 'limits'
> & { instructions?: Instruction[]; limits?: Record<string, LimitValue> };

export interface AgentConnectionView {
  connectionId: string;
  providerKey: string;
  name: string;
  status: string;
  accessLevel: string;
  connectionAccessLevel: string;
}

export interface PermissionRow {
  action_id: string;
  mode: string;
}

const asAgent = (row: Selectable<Agents>): AgentRow => ({
  ...row,
  instructions: (row.instructions ?? []) as unknown as Instruction[],
  limits: (row.limits ?? {}) as unknown as Record<string, LimitValue>,
});

const json = (value: unknown): string => JSON.stringify(value);

@Injectable()
export class AgentsRepository {
  async insert(db: Transaction<DB>, values: AgentInsert): Promise<AgentRow> {
    const { instructions, limits, ...rest } = values;
    const row = await db
      .insertInto('agents')
      .values({
        ...rest,
        ...(instructions ? { instructions: json(instructions) } : {}),
        ...(limits ? { limits: json(limits) } : {}),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return asAgent(row);
  }

  /** Inserts the manager unless the project already has one (idempotent). */
  async ensureManager(db: Transaction<DB>, values: AgentInsert): Promise<void> {
    await db
      .insertInto('agents')
      .values({ ...values, instructions: json([]), limits: json({}) })
      .onConflict((oc) => oc.column('project_id').where('kind', '=', 'manager').doNothing())
      .execute();
  }

  async list(db: Transaction<DB>, projectId: string): Promise<AgentRow[]> {
    const rows = await db
      .selectFrom('agents')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('deleted_at', 'is', null)
      .orderBy('kind', 'desc')
      .orderBy('hired_at')
      .execute();
    return rows.map(asAgent);
  }

  async countHired(db: Transaction<DB>, projectId: string): Promise<number> {
    const row = await db
      .selectFrom('agents')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('project_id', '=', projectId)
      .where('kind', '=', 'agent')
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async find(db: Transaction<DB>, projectId: string, id: string): Promise<AgentRow | undefined> {
    const row = await db
      .selectFrom('agents')
      .selectAll()
      .where('id', '=', id)
      .where('project_id', '=', projectId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? asAgent(row) : undefined;
  }

  /** Worker side: by id inside the current account. */
  async findById(db: Transaction<DB>, id: string): Promise<AgentRow | undefined> {
    const row = await db
      .selectFrom('agents')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? asAgent(row) : undefined;
  }

  async templateHired(db: Transaction<DB>, projectId: string, templateKey: string): Promise<boolean> {
    const row = await db
      .selectFrom('agents')
      .select('id')
      .where('project_id', '=', projectId)
      .where('template_key', '=', templateKey)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row !== undefined;
  }

  async update(db: Transaction<DB>, id: string, values: AgentUpdate): Promise<AgentRow | undefined> {
    const { instructions, limits, ...rest } = values;
    const row = await db
      .updateTable('agents')
      .set({
        ...rest,
        ...(instructions ? { instructions: json(instructions) } : {}),
        ...(limits ? { limits: json(limits) } : {}),
      })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return row ? asAgent(row) : undefined;
  }

  /** Fired: the agent disappears from the team, its history stays. */
  async softDelete(db: Transaction<DB>, id: string): Promise<void> {
    await db.deleteFrom('agent_connections').where('agent_id', '=', id).execute();
    await db
      .updateTable('agents')
      .set({ deleted_at: new Date() })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
  }

  // --- permissions ---------------------------------------------------------------------------

  listPermissions(db: Transaction<DB>, agentId: string): Promise<PermissionRow[]> {
    return db
      .selectFrom('agent_permissions')
      .select(['action_id', 'mode'])
      .where('agent_id', '=', agentId)
      .execute();
  }

  async setPermission(
    db: Transaction<DB>,
    values: {
      account_id: string;
      agent_id: string;
      action_id: string;
      mode: string | null;
      updated_by: string;
    },
  ): Promise<void> {
    if (values.mode === null) {
      await db
        .deleteFrom('agent_permissions')
        .where('agent_id', '=', values.agent_id)
        .where('action_id', '=', values.action_id)
        .execute();
      return;
    }
    await db
      .insertInto('agent_permissions')
      .values({ ...values, mode: values.mode })
      .onConflict((oc) =>
        oc.columns(['agent_id', 'action_id']).doUpdateSet({
          mode: values.mode as string,
          updated_by: values.updated_by,
          updated_at: new Date(),
        }),
      )
      .execute();
  }

  // --- connections ---------------------------------------------------------------------------

  listConnections(
    db: Transaction<DB>,
    agentIds: string[],
  ): Promise<Array<AgentConnectionView & { agentId: string }>> {
    if (agentIds.length === 0) return Promise.resolve([]);
    return db
      .selectFrom('agent_connections')
      .innerJoin('connections', 'connections.id', 'agent_connections.connection_id')
      .select([
        'agent_connections.agent_id as agentId',
        'agent_connections.connection_id as connectionId',
        'agent_connections.access_level as accessLevel',
        'connections.provider_key as providerKey',
        'connections.name as name',
        'connections.status as status',
        'connections.access_level as connectionAccessLevel',
      ])
      .where('agent_connections.agent_id', 'in', agentIds)
      .where('connections.deleted_at', 'is', null)
      .orderBy('agent_connections.created_at')
      .execute();
  }

  async replaceConnections(
    db: Transaction<DB>,
    accountId: string,
    agentId: string,
    items: Array<{ connectionId: string; accessLevel: string }>,
  ): Promise<void> {
    await db.deleteFrom('agent_connections').where('agent_id', '=', agentId).execute();
    if (items.length === 0) return;
    await db
      .insertInto('agent_connections')
      .values(
        items.map((item) => ({
          account_id: accountId,
          agent_id: agentId,
          connection_id: item.connectionId,
          access_level: item.accessLevel,
        })),
      )
      .execute();
  }

  // --- notes ---------------------------------------------------------------------------------

  listNotes(
    db: Transaction<DB>,
    agentId: string,
  ): Promise<Array<{ id: string; text: string; created_at: Date }>> {
    return db
      .selectFrom('agent_notes')
      .select(['id', 'text', 'created_at'])
      .where('agent_id', '=', agentId)
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();
  }

  async deleteNote(db: Transaction<DB>, agentId: string, noteId: string): Promise<boolean> {
    const result = await db
      .deleteFrom('agent_notes')
      .where('agent_id', '=', agentId)
      .where('id', '=', noteId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  // --- summaries -----------------------------------------------------------------------------

  listToolCallCountsSince(
    db: Transaction<DB>,
    projectId: string,
    since: Date,
  ): Promise<Array<{ agent_id: string; cnt: string; last_at: Date | null }>> {
    return db
      .selectFrom('tool_calls')
      .select([
        'agent_id',
        (eb) => eb.fn.countAll<string>().as('cnt'),
        (eb) => eb.fn.max('created_at').as('last_at'),
      ])
      .where('project_id', '=', projectId)
      .where('tool_id', 'like', '%.%')
      .where('created_at', '>', since)
      .groupBy('agent_id')
      .execute() as Promise<Array<{ agent_id: string; cnt: string; last_at: Date | null }>>;
  }

  listProjectTaskStatuses(
    db: Transaction<DB>,
    projectId: string,
  ): Promise<Array<{ agent_id: string; status: string; updated_at: Date }>> {
    return db
      .selectFrom('tasks')
      .select(['agent_id', 'status', 'updated_at'])
      .where('project_id', '=', projectId)
      .execute();
  }

  listProjectDecisionStatuses(
    db: Transaction<DB>,
    projectId: string,
  ): Promise<Array<{ agent_id: string; status: string }>> {
    return db
      .selectFrom('decisions')
      .select(['agent_id', 'status'])
      .where('project_id', '=', projectId)
      .where('status', 'in', ['accepted', 'modified', 'rejected', 'expired'])
      .execute();
  }

  findProjectAlwaysAsk(db: Transaction<DB>, projectId: string): Promise<{ always_ask: string[] }> {
    return db
      .selectFrom('projects')
      .select('always_ask')
      .where('id', '=', projectId)
      .executeTakeFirstOrThrow();
  }
}
