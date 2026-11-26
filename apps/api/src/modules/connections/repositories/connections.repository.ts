import { type Selectable, sql, type Transaction } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { ConnectionCredentials, ConnectionLinks, Connections, DB } from '../../../database/types.js';
import type { SealedSecret } from '../../../secrets/secret-cipher.js';

export type ConnectionRow = Omit<Selectable<Connections>, 'config'> & {
  config: Record<string, string>;
};
/** Credential metadata; the sealed value is read separately, only by the worker. */
export type CredentialMeta = Omit<Selectable<ConnectionCredentials>, 'ciphertext' | 'wrapped_key' | 'kek_id'>;
export type ConnectionLinkRow = Selectable<ConnectionLinks>;

const CREDENTIAL_META = [
  'id',
  'account_id',
  'project_id',
  'connection_id',
  'version',
  'masked',
  'status',
  'expires_at',
  'retire_at',
  'created_by',
  'created_at',
  'updated_at',
] as const;

const asConnection = (row: Selectable<Connections>): ConnectionRow => ({
  ...row,
  config: (row.config ?? {}) as Record<string, string>,
});

@Injectable()
export class ConnectionsRepository {
  async insert(
    db: Transaction<DB>,
    values: {
      account_id: string;
      project_id: string;
      provider_key: string;
      name: string;
      access_level: string;
      config: Record<string, string>;
      created_via: 'user' | 'dev_link';
      created_by: string | null;
    },
  ): Promise<ConnectionRow> {
    const row = await db
      .insertInto('connections')
      .values({ ...values, config: JSON.stringify(values.config) })
      .returningAll()
      .executeTakeFirstOrThrow();
    return asConnection(row);
  }

  async listForProject(db: Transaction<DB>, projectId: string): Promise<ConnectionRow[]> {
    const rows = await db
      .selectFrom('connections')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('deleted_at', 'is', null)
      .orderBy('created_at')
      .execute();
    return rows.map(asConnection);
  }

  async find(db: Transaction<DB>, projectId: string, id: string): Promise<ConnectionRow | undefined> {
    const row = await db
      .selectFrom('connections')
      .selectAll()
      .where('id', '=', id)
      .where('project_id', '=', projectId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? asConnection(row) : undefined;
  }

  /** Worker side: the connection by id inside the current account. */
  async findById(db: Transaction<DB>, id: string): Promise<ConnectionRow | undefined> {
    const row = await db
      .selectFrom('connections')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? asConnection(row) : undefined;
  }

  async update(
    db: Transaction<DB>,
    id: string,
    values: {
      name?: string;
      access_level?: string;
      config?: Record<string, string>;
      status?: string;
      status_reason?: string | null;
      status_detail?: string | null;
      last_check_at?: Date;
    },
  ): Promise<ConnectionRow | undefined> {
    const { config, ...rest } = values;
    const row = await db
      .updateTable('connections')
      .set({ ...rest, ...(config ? { config: JSON.stringify(config) } : {}) })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return row ? asConnection(row) : undefined;
  }

  /** Disconnect: the connection disappears and every credential version is destroyed. */
  async softDelete(db: Transaction<DB>, id: string): Promise<boolean> {
    await db.deleteFrom('connection_credentials').where('connection_id', '=', id).execute();
    const result = await db
      .updateTable('connections')
      .set({ deleted_at: new Date(), status: 'error', status_reason: null, status_detail: null })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  // --- credentials ---------------------------------------------------------------------------

  async insertCredential(
    db: Transaction<DB>,
    values: {
      id: string;
      account_id: string;
      project_id: string;
      connection_id: string;
      sealed: SealedSecret;
      masked: string;
      created_by: string | null;
      expires_at?: Date | null;
    },
  ): Promise<CredentialMeta> {
    const { sealed, ...rest } = values;
    const next = await db
      .selectFrom('connection_credentials')
      .select(sql<number>`coalesce(max(version), 0) + 1`.as('version'))
      .where('connection_id', '=', values.connection_id)
      .executeTakeFirstOrThrow();
    return db
      .insertInto('connection_credentials')
      .values({
        ...rest,
        version: next.version,
        ciphertext: sealed.ciphertext,
        wrapped_key: sealed.wrappedKey,
        kek_id: sealed.kekId,
      })
      .returning(CREDENTIAL_META)
      .executeTakeFirstOrThrow();
  }

  /** The active credential stops being active and keeps working until `retireAt`. */
  async retireActive(db: Transaction<DB>, connectionId: string, retireAt: Date): Promise<void> {
    await db
      .updateTable('connection_credentials')
      .set({ status: 'retiring', retire_at: retireAt })
      .where('connection_id', '=', connectionId)
      .where('status', '=', 'active')
      .execute();
  }

  activeCredential(db: Transaction<DB>, connectionId: string): Promise<CredentialMeta | undefined> {
    return db
      .selectFrom('connection_credentials')
      .select(CREDENTIAL_META)
      .where('connection_id', '=', connectionId)
      .where('status', '=', 'active')
      .executeTakeFirst();
  }

  /** Active credentials of all live connections of a project. */
  listActiveCredentials(db: Transaction<DB>, projectId: string): Promise<CredentialMeta[]> {
    return db
      .selectFrom('connection_credentials')
      .innerJoin('connections', 'connections.id', 'connection_credentials.connection_id')
      .select(CREDENTIAL_META.map((column) => `connection_credentials.${column}` as const))
      .where('connection_credentials.project_id', '=', projectId)
      .where('connection_credentials.status', '=', 'active')
      .where('connections.deleted_at', 'is', null)
      .execute();
  }

  /** Worker only: the sealed value of the active credential. */
  sealedActive(
    db: Transaction<DB>,
    connectionId: string,
  ): Promise<{ id: string; ciphertext: Buffer; wrapped_key: Buffer; kek_id: string } | undefined> {
    return db
      .selectFrom('connection_credentials')
      .select(['id', 'ciphertext', 'wrapped_key', 'kek_id'])
      .where('connection_id', '=', connectionId)
      .where('status', '=', 'active')
      .executeTakeFirst();
  }

  /** Destroys replaced credentials whose grace period is over. */
  async purgeRetired(db: Transaction<DB>, now: Date): Promise<number> {
    const result = await db
      .deleteFrom('connection_credentials')
      .where('status', '=', 'retiring')
      .where('retire_at', '<=', now)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  // --- developer links -------------------------------------------------------------------------

  insertLink(
    db: Transaction<DB>,
    values: {
      account_id: string;
      project_id: string;
      provider_key: string;
      token_hash: string;
      expires_at: Date;
      created_by: string;
    },
  ): Promise<ConnectionLinkRow> {
    return db.insertInto('connection_links').values(values).returningAll().executeTakeFirstOrThrow();
  }

  findLink(db: Transaction<DB>, id: string): Promise<ConnectionLinkRow | undefined> {
    return db.selectFrom('connection_links').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /** Marks the link used; false when someone else used it first. */
  async consumeLink(db: Transaction<DB>, id: string, connectionId: string): Promise<boolean> {
    const result = await db
      .updateTable('connection_links')
      .set({ used_at: new Date(), connection_id: connectionId })
      .where('id', '=', id)
      .where('used_at', 'is', null)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }
}
