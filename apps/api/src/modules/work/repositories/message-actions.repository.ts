import type { Selectable, Transaction } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { DB, MessageActions } from '../../../database/types.js';
import { json, parsed } from './json.js';

export const MESSAGE_ACTION_KINDS = ['reply', 'action', 'link', 'decision'] as const;
export type MessageActionKind = (typeof MESSAGE_ACTION_KINDS)[number];
export type MessageActionStatus = 'pending' | 'done' | 'failed' | 'expired';

export type MessageActionPayload =
  | { text: string }
  | { url: string }
  | {
      actionId: string;
      args: Record<string, unknown>;
      /** What pressing does, in words (the button label may be shorter). */
      summary: string;
    }
  | { decisionId: string; verdict: 'accept' | 'reject'; term?: string };

export type MessageActionRow = Omit<Selectable<MessageActions>, 'kind' | 'status' | 'payload'> & {
  kind: MessageActionKind;
  status: MessageActionStatus;
  payload: MessageActionPayload;
};

const asRow = (row: Selectable<MessageActions>): MessageActionRow => ({
  ...row,
  kind: row.kind as MessageActionKind,
  status: row.status as MessageActionStatus,
  payload: parsed<MessageActionPayload>(row.payload, { text: '' }),
});

/** Buttons of messages: the action stays on the server, the client sends the id. */
@Injectable()
export class MessageActionsRepository {
  async add(
    db: Transaction<DB>,
    input: {
      accountId: string;
      messageId: string;
      kind: MessageActionKind;
      label: string;
      payload: MessageActionPayload;
      expiresAt: Date;
    },
  ): Promise<MessageActionRow | undefined> {
    const last = await db
      .selectFrom('message_actions')
      .select((eb) => eb.fn.max('position').as('max'))
      .where('message_id', '=', input.messageId)
      .executeTakeFirst();
    const position = last?.max === null || last?.max === undefined ? 0 : Number(last.max) + 1;
    if (position > 11) return undefined;
    const row = await db
      .insertInto('message_actions')
      .values({
        account_id: input.accountId,
        message_id: input.messageId,
        position,
        kind: input.kind,
        label: input.label.slice(0, 64),
        payload: json(input.payload),
        expires_at: input.expiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return asRow(row);
  }

  async byMessages(db: Transaction<DB>, messageIds: string[]): Promise<MessageActionRow[]> {
    if (messageIds.length === 0) return [];
    const rows = await db
      .selectFrom('message_actions')
      .selectAll()
      .where('message_id', 'in', messageIds)
      .orderBy('position')
      .execute();
    return rows.map(asRow);
  }

  async find(db: Transaction<DB>, id: string, forUpdate = false): Promise<MessageActionRow | undefined> {
    let query = db.selectFrom('message_actions').selectAll().where('id', '=', id);
    if (forUpdate) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? asRow(row) : undefined;
  }

  async settle(
    db: Transaction<DB>,
    id: string,
    patch: { status: MessageActionStatus; result: string | null; usedBy: string | null },
  ): Promise<void> {
    await db
      .updateTable('message_actions')
      .set({
        status: patch.status,
        result: patch.result?.slice(0, 300) ?? null,
        used_by: patch.usedBy,
        used_at: patch.status === 'pending' ? null : new Date(),
      })
      .where('id', '=', id)
      .execute();
  }
}
