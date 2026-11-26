import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../common/context/app-cls-store.js';
import { randomToken, sha256 } from '../../common/crypto.js';
import { DEFAULT_LOCALE, type Locale } from '../../common/i18n/locales.js';
import type { Env } from '../../config/env.schema.js';
import { AccountDb, type AccountTx } from '../../database/scoped-db.js';
import { SystemDb } from '../../database/system-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { SECRET_SEALER, type SecretSealer } from '../../secrets/secret-cipher.js';
import type { Actor } from '../accounts/account-context.js';
import { MailService } from '../mail/mail.service.js';
import { ProjectContext } from '../projects/project-context.js';
import { ConnectionCheckRunner } from './connection-check.runner.js';
import type { CheckOutcome } from './connection-check.types.js';
import { CONNECTION_ERRORS, ConnectionException } from './connections.errors.js';
import { credentialAad } from './credential-aad.js';
import type { CreateConnectionDto, UpdateConnectionDto } from './dto/connection.dto.js';
import { CONNECTION_EVENTS, type ConnectionEvent } from './events/connection.events.js';
import { mask, splitFields } from './providers/fields.js';
import {
  type AccessLevel,
  CONNECTION_CATEGORIES,
  type ConnectionCategory,
  type ProviderDefinition,
} from './providers/provider.types.js';
import { findProvider } from './providers/registry.js';
import { generateSshKeyPair } from './providers/ssh.js';
import {
  type ConnectionLinkRow,
  type ConnectionRow,
  ConnectionsRepository,
  type CredentialMeta,
} from './repositories/connections.repository.js';

/** A replaced credential keeps working this long, so in-flight work finishes. */
const RETIRE_AFTER_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ConnectionView {
  connection: ConnectionRow;
  credential?: CredentialMeta;
}

interface SealedInput {
  config: Record<string, string>;
  secret: Record<string, string>;
  masked: string;
}

@Injectable()
export class ConnectionsService {
  private readonly appUrl: string;
  private readonly linkTtlDays: number;

  constructor(
    private readonly accountDb: AccountDb,
    private readonly systemDb: SystemDb,
    private readonly connections: ConnectionsRepository,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
    private readonly checks: ConnectionCheckRunner,
    private readonly mail: MailService,
    private readonly projectContext: ProjectContext,
    private readonly cls: ClsService<AppClsStore>,
    @Inject(SECRET_SEALER) private readonly sealer: SecretSealer,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_PUBLIC_URL', { infer: true }).replace(/\/+$/, '');
    this.linkTtlDays = config.get('DEV_LINK_TTL_DAYS', { infer: true });
  }

  async list(): Promise<ConnectionView[]> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const rows = await this.connections.listForProject(tx.db, projectId);
      const credentials = await this.connections.listActiveCredentials(tx.db, projectId);
      const byConnection = new Map(credentials.map((c) => [c.connection_id, c]));
      return rows.map((connection) => ({ connection, credential: byConnection.get(connection.id) }));
    });
  }

  /** Coverage: a category counts once it has a working (ok or warn) connection. */
  async summary(): Promise<{
    coveragePct: number;
    working: number;
    attention: number;
    missingCategories: ConnectionCategory[];
  }> {
    const { projectId } = this.projectContext.actor();
    const rows = await this.accountDb.transaction((tx) => this.connections.listForProject(tx.db, projectId));
    const covered = new Set<ConnectionCategory>();
    let working = 0;
    let attention = 0;
    for (const row of rows) {
      const category = findProvider(row.provider_key)?.category;
      if (row.status === 'ok') working += 1;
      if (row.status === 'warn' || row.status === 'error') attention += 1;
      if (category && (row.status === 'ok' || row.status === 'warn')) covered.add(category);
    }
    const categories = Object.keys(CONNECTION_CATEGORIES) as ConnectionCategory[];
    return {
      coveragePct: Math.min(
        100,
        [...covered].reduce((sum, category) => sum + CONNECTION_CATEGORIES[category], 0),
      ),
      working,
      attention,
      missingCategories: categories.filter((category) => !covered.has(category)),
    };
  }

  /** Creates the connection, seals its secret and checks it right away. */
  async create(dto: CreateConnectionDto): Promise<{ view: ConnectionView; check: CheckOutcome | null }> {
    const actor = this.projectContext.actor();
    const provider = this.provider(dto.providerKey);
    const accessLevel = this.accessLevel(provider, dto.accessLevel);
    const input = this.prepare(provider, dto.fields);
    const view = await this.accountDb.transaction((tx) =>
      this.insertConnection(tx, {
        projectId: actor.projectId,
        provider,
        name: dto.name ?? provider.key,
        accessLevel,
        input,
        createdVia: 'user',
        actor,
      }),
    );
    const check = await this.checks.runAndWait(view.connection, actor.userId);
    return { view: (await this.reload(view.connection.id)) ?? view, check };
  }

  async update(id: string, dto: UpdateConnectionDto): Promise<ConnectionView> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const current = await this.mustFind(tx, actor.projectId, id);
      const provider = this.provider(current.provider_key);
      const values = {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.accessLevel ? { access_level: this.accessLevel(provider, dto.accessLevel) } : {}),
      };
      const connection = (await this.connections.update(tx.db, id, values)) ?? notFound();
      await this.record(tx, actor, id, 'connections.update', values);
      await this.event(tx, CONNECTION_EVENTS.UPDATED, connection, actor.userId);
      return { connection, credential: await this.connections.activeCredential(tx.db, id) };
    });
  }

  /**
   * New credential version. The previous one keeps working for five minutes so running
   * work is not cut off, then the maintenance job destroys it. For SSH a new key pair is
   * generated and the new public key must be installed on the server.
   */
  async rotate(
    id: string,
    fields: Record<string, string> | undefined,
  ): Promise<{ view: ConnectionView; check: CheckOutcome | null }> {
    const actor = this.projectContext.actor();
    const view = await this.accountDb.transaction(async (tx) => {
      const current = await this.mustFind(tx, actor.projectId, id);
      const provider = this.provider(current.provider_key);
      let input: SealedInput;
      if (provider.sshKey) {
        input = this.sshInput(current.config);
      } else {
        const { secret } = splitFields(provider, fields ?? {}, { secretsOnly: true });
        input = { config: current.config, secret, masked: this.maskOf(provider, secret) };
      }
      await this.connections.retireActive(tx.db, id, new Date(Date.now() + RETIRE_AFTER_MS));
      const credential = await this.sealAndInsert(tx, current, input, actor.userId);
      const connection =
        (await this.connections.update(tx.db, id, {
          config: input.config,
          status: 'pending',
          status_reason: null,
          status_detail: null,
        })) ?? notFound();
      await this.record(tx, actor, id, 'connections.credential.rotate', {
        provider: provider.key,
        version: credential.version,
      });
      await this.event(tx, CONNECTION_EVENTS.ROTATED, connection, actor.userId);
      return { connection, credential };
    });
    const check = await this.checks.runAndWait(view.connection, actor.userId);
    return { view: (await this.reload(id)) ?? view, check };
  }

  async check(id: string): Promise<{ view: ConnectionView; check: CheckOutcome | null }> {
    const actor = this.projectContext.actor();
    const current = await this.accountDb.transaction((tx) => this.mustFind(tx, actor.projectId, id));
    const check = await this.checks.runAndWait(current, actor.userId);
    return { view: (await this.reload(id)) ?? { connection: current }, check };
  }

  /** Disconnect: credentials are destroyed at once, agents lose access. */
  async disconnect(id: string): Promise<void> {
    const actor = this.projectContext.actor();
    await this.accountDb.transaction(async (tx) => {
      const current = await this.mustFind(tx, actor.projectId, id);
      await this.connections.softDelete(tx.db, id);
      await this.record(tx, actor, id, 'connections.disconnect', { provider: current.provider_key });
      await this.event(tx, CONNECTION_EVENTS.DISCONNECTED, current, actor.userId);
    });
  }

  /** Danger zone. Returns how many connections were removed. */
  async disconnectAll(): Promise<number> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const rows = await this.connections.listForProject(tx.db, actor.projectId);
      for (const row of rows) {
        await this.connections.softDelete(tx.db, row.id);
        await this.record(tx, actor, row.id, 'connections.disconnect', {
          provider: row.provider_key,
          all: true,
        });
        await this.event(tx, CONNECTION_EVENTS.DISCONNECTED, row, actor.userId);
      }
      return rows.length;
    });
  }

  // --- developer links ------------------------------------------------------------------

  async createLink(providerKey: string): Promise<{ url: string; expiresAt: Date }> {
    const actor = this.projectContext.actor();
    const provider = this.provider(providerKey);
    if (provider.sshKey) {
      throw new ConnectionException(CONNECTION_ERRORS.CONNECTION_LINK_UNSUPPORTED);
    }
    const token = randomToken();
    const expiresAt = new Date(Date.now() + this.linkTtlDays * DAY_MS);
    await this.accountDb.transaction(async (tx) => {
      const link = await this.connections.insertLink(tx.db, {
        account_id: tx.accountId,
        project_id: actor.projectId,
        provider_key: provider.key,
        token_hash: sha256(token),
        expires_at: expiresAt,
        created_by: actor.userId,
      });
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action: 'connections.link.create',
        target: { type: 'connection_link', id: link.id },
        args: { provider: provider.key, expiresAt: expiresAt.toISOString() },
        status: 'succeeded',
      });
      await this.outbox.add(tx, {
        type: CONNECTION_EVENTS.LINK_CREATED,
        payload: { projectId: actor.projectId, linkId: link.id, providerKey: provider.key },
      });
    });
    return { url: `${this.appUrl}/connect/${token}`, expiresAt };
  }

  /** What the developer's page needs. No sign-in: the token is the only credential. */
  async describeLink(token: string): Promise<{
    projectName: string;
    provider: ProviderDefinition;
    expiresAt: Date;
  }> {
    const link = await this.resolveLink(token);
    const projectName = await this.withAccount(link.account_id, () =>
      this.accountDb.transaction(async (tx) => {
        const row = await tx.db
          .selectFrom('projects')
          .select('name')
          .where('id', '=', link.project_id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        return row?.name;
      }),
    );
    if (!projectName) throw new ConnectionException(CONNECTION_ERRORS.CONNECTION_LINK_NOT_FOUND);
    return { projectName, provider: this.provider(link.provider_key), expiresAt: link.expires_at };
  }

  async submitLink(token: string, fields: Record<string, string>): Promise<CheckOutcome | null> {
    const link = await this.resolveLink(token);
    const provider = this.provider(link.provider_key);
    const input = this.prepare(provider, fields);
    return this.withAccount(link.account_id, async () => {
      const result = await this.accountDb.transaction(async (tx) => {
        const fresh = (await this.connections.findLink(tx.db, link.id)) ?? linkNotFound();
        this.assertUsable(fresh);
        const view = await this.insertConnection(tx, {
          projectId: link.project_id,
          provider,
          name: provider.key,
          accessLevel: provider.accessLevels[0] ?? 'read',
          input,
          createdVia: 'dev_link',
          actor: null,
        });
        if (!(await this.connections.consumeLink(tx.db, link.id, view.connection.id))) {
          throw new ConnectionException(CONNECTION_ERRORS.CONNECTION_LINK_USED);
        }
        await this.outbox.add(tx, {
          type: CONNECTION_EVENTS.LINK_USED,
          payload: {
            projectId: link.project_id,
            linkId: link.id,
            connectionId: view.connection.id,
          },
        });
        const creator = await tx.db
          .selectFrom('users')
          .select(['email', 'locale'])
          .where('id', '=', fresh.created_by)
          .executeTakeFirst();
        const project = await tx.db
          .selectFrom('projects')
          .select(['name', 'slug'])
          .where('id', '=', link.project_id)
          .executeTakeFirstOrThrow();
        return { view, creator, project };
      });
      const check = await this.checks.runAndWait(result.view.connection, null);
      if (result.creator) {
        await this.mail.send({
          to: result.creator.email,
          template: 'connection_ready',
          locale: (result.creator.locale ?? DEFAULT_LOCALE) as Locale,
          params: {
            project: result.project.name,
            provider: provider.key,
            status: check?.status ?? 'pending',
            link: `${this.appUrl}/p/${result.project.slug}/connections`,
          },
        });
      }
      return check;
    });
  }

  // --- internals ----------------------------------------------------------------------------

  private provider(key: string): ProviderDefinition {
    const provider = findProvider(key);
    if (!provider) throw new ConnectionException(CONNECTION_ERRORS.CONNECTION_PROVIDER_UNKNOWN);
    return provider;
  }

  private accessLevel(provider: ProviderDefinition, wanted: AccessLevel | undefined): AccessLevel {
    const level = wanted ?? 'read';
    if (!provider.accessLevels.includes(level)) {
      throw new ConnectionException(CONNECTION_ERRORS.CONNECTION_ACCESS_UNSUPPORTED);
    }
    return level;
  }

  private prepare(provider: ProviderDefinition, fields: Record<string, string>): SealedInput {
    const { config, secret } = splitFields(provider, fields);
    if (provider.sshKey) {
      return this.sshInput(config);
    }
    return { config, secret, masked: this.maskOf(provider, secret) };
  }

  private sshInput(config: Record<string, string>): SealedInput {
    const pair = generateSshKeyPair('geniebox-agent');
    return {
      config: { ...config, public_key: pair.publicKey },
      secret: { private_key: pair.privateKey },
      masked: `ed25519 ${mask(pair.publicKey.split(' ')[1] ?? '')}`,
    };
  }

  private maskOf(provider: ProviderDefinition, secret: Record<string, string>): string {
    return mask(provider.maskField ? (secret[provider.maskField] ?? '') : '');
  }

  private async insertConnection(
    tx: AccountTx,
    params: {
      projectId: string;
      provider: ProviderDefinition;
      name: string;
      accessLevel: AccessLevel;
      input: SealedInput;
      createdVia: 'user' | 'dev_link';
      actor: (Actor & { projectId: string }) | null;
    },
  ): Promise<ConnectionView> {
    const connection = await this.connections.insert(tx.db, {
      account_id: tx.accountId,
      project_id: params.projectId,
      provider_key: params.provider.key,
      name: params.name,
      access_level: params.accessLevel,
      config: params.input.config,
      created_via: params.createdVia,
      created_by: params.actor?.userId ?? null,
    });
    const credential = await this.sealAndInsert(tx, connection, params.input, params.actor?.userId ?? null);
    await this.journal.record(tx, {
      actor: params.actor
        ? { type: 'user', id: params.actor.userId, role: params.actor.role }
        : { type: 'system', id: 'developer-link' },
      action: 'connections.create',
      target: { type: 'connection', id: connection.id },
      // Field names only: values (even non-secret ones) stay out of the journal.
      args: {
        provider: params.provider.key,
        accessLevel: params.accessLevel,
        via: params.createdVia,
        fields: Object.keys(params.input.config),
      },
      status: 'succeeded',
    });
    await this.event(tx, CONNECTION_EVENTS.CREATED, connection, params.actor?.userId ?? null);
    return { connection, credential };
  }

  private sealAndInsert(
    tx: AccountTx,
    connection: ConnectionRow,
    input: SealedInput,
    userId: string | null,
  ): Promise<CredentialMeta> {
    const id = randomUUID();
    const plain = Buffer.from(JSON.stringify(input.secret), 'utf8');
    try {
      const sealed = this.sealer.seal(plain, credentialAad(connection.account_id, connection.project_id, id));
      return this.connections.insertCredential(tx.db, {
        id,
        account_id: connection.account_id,
        project_id: connection.project_id,
        connection_id: connection.id,
        sealed,
        masked: input.masked,
        created_by: userId,
      });
    } finally {
      plain.fill(0);
    }
  }

  private async reload(id: string): Promise<ConnectionView | undefined> {
    return this.accountDb.transaction(async (tx) => {
      const connection = await this.connections.findById(tx.db, id);
      if (!connection) return undefined;
      return { connection, credential: await this.connections.activeCredential(tx.db, id) };
    });
  }

  private async mustFind(tx: AccountTx, projectId: string, id: string): Promise<ConnectionRow> {
    return (await this.connections.find(tx.db, projectId, id)) ?? notFound();
  }

  /** SystemDb: the token is resolved before any account is known (reason: public link). */
  private async resolveLink(token: string): Promise<ConnectionLinkRow> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) linkNotFound();
    const link = await this.systemDb.transaction((trx) =>
      trx
        .selectFrom('connection_links')
        .select([
          'id',
          'account_id',
          'project_id',
          'provider_key',
          'token_hash',
          'expires_at',
          'used_at',
          'revoked_at',
        ])
        .where('token_hash', '=', sha256(token))
        .executeTakeFirst(),
    );
    if (!link) linkNotFound();
    this.assertUsable(link);
    return link as ConnectionLinkRow;
  }

  private assertUsable(link: Pick<ConnectionLinkRow, 'used_at' | 'revoked_at' | 'expires_at'>): void {
    if (link.revoked_at) linkNotFound();
    if (link.used_at) throw new ConnectionException(CONNECTION_ERRORS.CONNECTION_LINK_USED);
    if (link.expires_at.getTime() <= Date.now()) {
      throw new ConnectionException(CONNECTION_ERRORS.CONNECTION_LINK_EXPIRED);
    }
  }

  /** Runs account-scoped work for a request that has no signed-in user (developer link). */
  private withAccount<T>(accountId: string, work: () => Promise<T>): Promise<T> {
    this.cls.set('accountId', accountId);
    return work();
  }

  private record(
    tx: AccountTx,
    actor: Actor,
    connectionId: string,
    action: string,
    args: unknown,
  ): Promise<void> {
    return this.journal.record(tx, {
      actor: { type: 'user', id: actor.userId, role: actor.role },
      action,
      target: { type: 'connection', id: connectionId },
      args,
      status: 'succeeded',
    });
  }

  private event(
    tx: AccountTx,
    type: string,
    connection: ConnectionRow,
    userId: string | null,
  ): Promise<void> {
    return this.outbox.add<ConnectionEvent>(tx, {
      type,
      payload: {
        projectId: connection.project_id,
        connectionId: connection.id,
        providerKey: connection.provider_key,
        byUserId: userId,
      },
    });
  }
}

function notFound(): never {
  throw new ConnectionException(CONNECTION_ERRORS.CONNECTION_NOT_FOUND);
}

function linkNotFound(): never {
  throw new ConnectionException(CONNECTION_ERRORS.CONNECTION_LINK_NOT_FOUND);
}
