import { randomUUID } from 'node:crypto';

import { type Selectable, sql, type Transaction } from 'kysely';

import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { agentSchema, agentVersionSchema, type CreateAgent, type UpdateAgent } from '@workspace/types';

import { TenantDb } from '../../database/tenant-db.js';
import type { Agents, DB } from '../../database/types.js';
import { JournalService } from '../../journal/journal.service.js';
import type { CatalogAgent } from '../catalog/catalog.service.js';

export interface AgentOwner {
  tenantId: string;
  userId: string;
}

const maxAgents = 20;
const fields = ['id', 'name', 'instructions', 'enabled', 'catalog_key', 'revision'] as const;
type AgentRow = Pick<Selectable<Agents>, (typeof fields)[number]>;

function dto(row: AgentRow) {
  const { catalog_key, ...properties } = row;
  return agentSchema.parse({ ...properties, catalogKey: catalog_key });
}

function owned(tx: Transaction<DB>, owner: AgentOwner) {
  return tx.selectFrom('agents').where('tenant_id', '=', owner.tenantId).where('user_id', '=', owner.userId);
}

function versions(tx: Transaction<DB>, owner: AgentOwner, id: string) {
  return tx
    .selectFrom('agent_versions')
    .where('tenant_id', '=', owner.tenantId)
    .where('user_id', '=', owner.userId)
    .where('agent_id', '=', id);
}

@Injectable()
export class AgentsRepository {
  constructor(
    private readonly db: TenantDb,
    private readonly journal: JournalService,
    private readonly context: ClsService,
  ) {}

  list(owner: AgentOwner, catalog: readonly CatalogAgent[]) {
    return this.db.transaction(async (tx) => {
      const query = owned(tx, owner).select(fields).orderBy('name').orderBy('id');
      let rows = await query.execute();
      const existing = new Set(rows.map(({ catalog_key }) => catalog_key));
      const missing = catalog.filter(({ key }) => !existing.has(key));
      if (missing.length) {
        await tx
          .insertInto('agents')
          .values(
            missing.map(({ key, name, instructions }) => ({
              tenant_id: owner.tenantId,
              user_id: owner.userId,
              id: randomUUID(),
              catalog_key: key,
              name,
              instructions,
              enabled: false,
            })),
          )
          .onConflict((constraint) => constraint.columns(['tenant_id', 'user_id', 'catalog_key']).doNothing())
          .execute();
        rows = await query.execute();
      }
      return rows.map(dto);
    });
  }

  async find(owner: AgentOwner, id: string) {
    const row = await this.db.transaction((tx) =>
      owned(tx, owner).select(fields).where('id', '=', id).executeTakeFirst(),
    );
    return row && dto(row);
  }

  create(owner: AgentOwner, input: CreateAgent) {
    return this.db.transaction(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`agents:${owner.tenantId}:${owner.userId}`}, 0))`.execute(
        tx,
      );
      const { count } = await owned(tx, owner)
        .where('catalog_key', 'is', null)
        .select((eb) => eb.fn.countAll().as('count'))
        .executeTakeFirstOrThrow();
      if (Number(count) >= maxAgents) return undefined;
      const row = await tx
        .insertInto('agents')
        .values({
          ...input,
          tenant_id: owner.tenantId,
          user_id: owner.userId,
          id: randomUUID(),
        })
        .returning(fields)
        .executeTakeFirstOrThrow();
      return dto(row);
    });
  }

  update(owner: AgentOwner, id: string, { expectedRevision, ...input }: UpdateAgent) {
    return this.db.transaction(async (tx) => {
      const current = await owned(tx, owner)
        .select('revision')
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!current) return 'missing';
      if (expectedRevision !== undefined && current.revision !== expectedRevision) return 'conflict';
      return this.save(tx, owner, id, input);
    });
  }

  history(owner: AgentOwner, id: string, before?: number) {
    return this.db.transaction(async (tx) => {
      if (!(await owned(tx, owner).select('id').where('id', '=', id).executeTakeFirst())) return undefined;
      let query = versions(tx, owner, id).select(['revision', 'name', 'instructions', 'created_at']);
      if (before !== undefined) query = query.where('revision', '<', before);
      const history = await query.orderBy('revision', 'desc').limit(21).execute();
      const items = history
        .slice(0, 20)
        .map(({ created_at, ...row }) =>
          agentVersionSchema.parse({ ...row, createdAt: created_at.toISOString() }),
        );
      return { items, next: history.length > 20 ? (items.at(-1)?.revision ?? null) : null };
    });
  }

  restore(owner: AgentOwner, id: string, revision: number, expectedRevision: number) {
    return this.db.transaction(async (tx) => {
      const current = await owned(tx, owner)
        .select('revision')
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!current) return 'missing';
      if (current.revision !== expectedRevision) return 'conflict';
      const snapshot = await versions(tx, owner, id)
        .select(['name', 'instructions'])
        .where('revision', '=', revision)
        .executeTakeFirst();
      if (!snapshot) return 'missing';
      return this.save(tx, owner, id, snapshot);
    });
  }

  private async save(
    tx: Transaction<DB>,
    owner: AgentOwner,
    id: string,
    input: Omit<UpdateAgent, 'expectedRevision'>,
  ) {
    const row = await tx
      .updateTable('agents')
      .set(input)
      .where('tenant_id', '=', owner.tenantId)
      .where('user_id', '=', owner.userId)
      .where('id', '=', id)
      .returning(fields)
      .executeTakeFirstOrThrow();
    await this.journal.append(tx, {
      tenantId: owner.tenantId,
      traceId: this.context.getId() ?? randomUUID(),
      action: 'agent.settings_updated',
      targetId: id,
      actor: { kind: 'user', id: owner.userId },
      details: { revision: row.revision, enabled: row.enabled },
    });
    return dto(row);
  }
}
