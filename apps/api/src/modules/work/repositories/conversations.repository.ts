import { type Insertable, type Selectable, sql, type Transaction, type Updateable } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { Conversations, DB, Messages } from '../../../database/types.js';
import type { Card, MessageStatus, RequestMode } from '../work.constants.js';
import { json, parsed } from './json.js';

export type ConversationRow = Selectable<Conversations>;
export type MessageRow = Omit<Selectable<Messages>, 'cards' | 'status' | 'mode'> & {
  cards: Card[];
  status: MessageStatus;
  mode: RequestMode | null;
};
export type MessageInsert = Omit<Insertable<Messages>, 'cards'> & {
  cards?: Card[];
};

const asMessage = (row: Selectable<Messages>): MessageRow => ({
  ...row,
  cards: parsed<Card[]>(row.cards, []),
  status: row.status as MessageStatus,
  mode: row.mode as RequestMode | null,
});

@Injectable()
export class ConversationsRepository {
  create(db: Transaction<DB>, values: Insertable<Conversations>): Promise<ConversationRow> {
    return db.insertInto('conversations').values(values).returningAll().executeTakeFirstOrThrow();
  }

  async managerForUser(
    db: Transaction<DB>,
    projectId: string,
    userId: string,
  ): Promise<ConversationRow | undefined> {
    return db
      .selectFrom('conversations')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('created_by', '=', userId)
      .where('manager_thread', '=', true)
      .executeTakeFirst();
  }

  async ensureManager(
    db: Transaction<DB>,
    accountId: string,
    projectId: string,
    userId: string,
    agentId: string,
  ) {
    return db
      .insertInto('conversations')
      .values({
        account_id: accountId,
        project_id: projectId,
        created_by: userId,
        agent_id: agentId,
        manager_thread: true,
      })
      .onConflict((conflict) =>
        conflict
          .columns(['project_id', 'created_by'])
          .where(sql<boolean>`manager_thread`)
          .doUpdateSet({ agent_id: agentId }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  find(db: Transaction<DB>, projectId: string, id: string): Promise<ConversationRow | undefined> {
    return db
      .selectFrom('conversations')
      .selectAll()
      .where('id', '=', id)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
  }

  findById(db: Transaction<DB>, id: string): Promise<ConversationRow | undefined> {
    return db.selectFrom('conversations').selectAll().where('id', '=', id).executeTakeFirst();
  }

  list(
    db: Transaction<DB>,
    projectId: string,
    agentId: string | undefined,
    limit: number,
    userId: string,
  ): Promise<ConversationRow[]> {
    let query = db
      .selectFrom('conversations')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('created_by', '=', userId)
      .where('private_archive', '=', false);
    if (agentId) query = query.where('agent_id', '=', agentId);
    return query.orderBy('last_message_at', 'desc').limit(limit).execute();
  }

  async touch(db: Transaction<DB>, id: string, title?: string): Promise<void> {
    await db
      .updateTable('conversations')
      .set({ last_message_at: new Date(), ...(title ? { title: title.slice(0, 120) } : {}) })
      .where('id', '=', id)
      .execute();
  }

  // --- messages ------------------------------------------------------------------------------

  async insertMessage(db: Transaction<DB>, input: MessageInsert): Promise<MessageRow> {
    const { cards, ...rest } = input;
    const row = await db
      .insertInto('messages')
      .values({ ...rest, cards: json(cards ?? []) })
      .returningAll()
      .executeTakeFirstOrThrow();
    return asMessage(row);
  }

  async insertNotification(
    db: Transaction<DB>,
    input: Insertable<Messages>,
  ): Promise<MessageRow | undefined> {
    const row = await db
      .insertInto('messages')
      .values(input)
      .onConflict((conflict) =>
        conflict.columns(['conversation_id', 'notification_event_id', 'notification_kind']).doNothing(),
      )
      .returningAll()
      .executeTakeFirst();
    return row ? asMessage(row) : undefined;
  }

  async lock(db: Transaction<DB>, id: string): Promise<void> {
    await db
      .selectFrom('conversations')
      .select('id')
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirstOrThrow();
  }

  async findMessage(db: Transaction<DB>, id: string, after?: string | null): Promise<MessageRow | undefined> {
    let query = db.selectFrom('messages').selectAll().where('id', '=', id);
    if (after) query = query.where('created_at', '>', sql<Date>`${after}::timestamptz`);
    const row = await query.executeTakeFirst();
    return row ? asMessage(row) : undefined;
  }

  async listMessages(
    db: Transaction<DB>,
    conversationId: string,
    limit: number,
    options: {
      before?: Date;
      beforeId?: string;
      noticeKinds?: readonly string[];
      after?: string | null;
    } = {},
  ): Promise<MessageRow[]> {
    const { before, beforeId, noticeKinds, after } = options;
    let query = db.selectFrom('messages').selectAll().where('conversation_id', '=', conversationId);
    if (beforeId) {
      query = query.where(sql<boolean>`
        (created_at, case when role = 'user' then 0 else 1 end, id) <
          (select created_at, case when role = 'user' then 0 else 1 end, id
            from messages where id = ${beforeId} and conversation_id = ${conversationId})
      `);
    } else if (before) {
      query = query.where('created_at', '<', before);
    }
    if (after) query = query.where('created_at', '>', sql<Date>`${after}::timestamptz`);
    if (noticeKinds?.length === 0) query = query.where('notification_kind', 'is', null);
    else if (noticeKinds) {
      query = query.where((eb) =>
        eb.or([eb('notification_kind', 'is', null), eb('notification_kind', 'in', noticeKinds)]),
      );
    }
    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy(sql`case when role = 'user' then 0 else 1 end`, 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
    return rows.reverse().map(asMessage);
  }

  /**
   * Saves the part of an answer written so far. Only while the message is still streaming, so a
   * late save can never overwrite the final text (the row lock makes it re-check after finish).
   */
  async saveStreamingText(db: Transaction<DB>, id: string, text: string): Promise<void> {
    await db
      .updateTable('messages')
      .set({ text })
      .where('id', '=', id)
      .where('status', '=', 'streaming')
      .execute();
  }

  async hasStreaming(db: Transaction<DB>, conversationId: string, after?: string | null): Promise<boolean> {
    let query = db
      .selectFrom('messages')
      .select('id')
      .where('conversation_id', '=', conversationId)
      .where('status', '=', 'streaming')
      .where('created_at', '>', new Date(Date.now() - 5 * 60_000));
    if (after) query = query.where('created_at', '>', sql<Date>`${after}::timestamptz`);
    return Boolean(await query.executeTakeFirst());
  }

  async updateMessage(
    db: Transaction<DB>,
    id: string,
    values: Omit<Updateable<Messages>, 'id' | 'account_id' | 'cards'> & { cards?: Card[] },
  ): Promise<MessageRow | undefined> {
    const { cards, ...rest } = values;
    const row = await db
      .updateTable('messages')
      .set({ ...rest, ...(cards ? { cards: json(cards) } : {}) })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row ? asMessage(row) : undefined;
  }

  /** Adds a card to a message unless it is there already. */
  async addCard(db: Transaction<DB>, id: string, card: Card): Promise<void> {
    const message = await this.findMessage(db, id);
    if (!message || message.cards.some((c) => c.type === card.type && c.id === card.id)) return;
    await this.updateMessage(db, id, { cards: [...message.cards, card].slice(0, 20) });
  }
}
