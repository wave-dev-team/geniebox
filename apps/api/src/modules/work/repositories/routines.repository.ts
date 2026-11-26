import type { Insertable, Selectable, Transaction, Updateable } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { DB, Routines } from '../../../database/types.js';

export type RoutineRow = Selectable<Routines>;

@Injectable()
export class RoutinesRepository {
  /** System routines (`kind`) are created once per project. */
  async insert(db: Transaction<DB>, values: Insertable<Routines>): Promise<RoutineRow | undefined> {
    return db
      .insertInto('routines')
      .values(values)
      .onConflict((oc) => oc.columns(['project_id', 'kind']).where('kind', 'is not', null).doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  find(db: Transaction<DB>, projectId: string, id: string): Promise<RoutineRow | undefined> {
    return db
      .selectFrom('routines')
      .selectAll()
      .where('id', '=', id)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
  }

  findById(db: Transaction<DB>, id: string): Promise<RoutineRow | undefined> {
    return db.selectFrom('routines').selectAll().where('id', '=', id).executeTakeFirst();
  }

  list(db: Transaction<DB>, projectId: string, agentId?: string): Promise<RoutineRow[]> {
    let query = db.selectFrom('routines').selectAll().where('project_id', '=', projectId);
    if (agentId) query = query.where('agent_id', '=', agentId);
    return query.orderBy('created_at').execute();
  }

  update(
    db: Transaction<DB>,
    id: string,
    values: Omit<Updateable<Routines>, 'id' | 'account_id' | 'project_id'>,
  ): Promise<RoutineRow | undefined> {
    return db.updateTable('routines').set(values).where('id', '=', id).returningAll().executeTakeFirst();
  }
}
