import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { CreateAgent, UpdateAgent } from '@workspace/types';

import { TenantDb } from '../../database/tenant-db.js';

export interface AgentOwner {
  tenantId: string;
  userId: string;
}

const fields = ['id', 'name', 'instructions', 'enabled'] as const;
const maxAgents = 20;

@Injectable()
export class AgentsRepository {
  constructor(private readonly db: TenantDb) {}

  list(owner: AgentOwner) {
    return this.db.transaction((tx) =>
      tx
        .selectFrom('agents')
        .select(fields)
        .where('tenant_id', '=', owner.tenantId)
        .where('user_id', '=', owner.userId)
        .orderBy('name')
        .orderBy('id')
        .execute(),
    );
  }

  find(owner: AgentOwner, id: string) {
    return this.db.transaction((tx) =>
      tx
        .selectFrom('agents')
        .select(fields)
        .where('tenant_id', '=', owner.tenantId)
        .where('user_id', '=', owner.userId)
        .where('id', '=', id)
        .executeTakeFirst(),
    );
  }

  create(owner: AgentOwner, input: CreateAgent) {
    return this.db.transaction(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`agents:${owner.tenantId}:${owner.userId}`}, 0))`.execute(
        tx,
      );
      const { count } = await tx
        .selectFrom('agents')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('tenant_id', '=', owner.tenantId)
        .where('user_id', '=', owner.userId)
        .executeTakeFirstOrThrow();
      if (Number(count) >= maxAgents) return undefined;
      return tx
        .insertInto('agents')
        .values({
          ...input,
          tenant_id: owner.tenantId,
          user_id: owner.userId,
          id: randomUUID(),
        })
        .returning(fields)
        .executeTakeFirstOrThrow();
    });
  }

  update(owner: AgentOwner, id: string, input: UpdateAgent) {
    return this.db.transaction((tx) =>
      tx
        .updateTable('agents')
        .set(input)
        .where('tenant_id', '=', owner.tenantId)
        .where('user_id', '=', owner.userId)
        .where('id', '=', id)
        .returning(fields)
        .executeTakeFirst(),
    );
  }
}
