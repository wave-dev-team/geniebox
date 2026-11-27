import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';
import { AccountDb } from '../../database/scoped-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { SECRET_OPENER, type SecretOpener } from '../../secrets/secret-cipher.js';
import type { CheckOutcome } from './connection-check.types.js';
import { credentialAad } from './credential-aad.js';
import { CONNECTION_EVENTS, type ConnectionStatusChangedEvent } from './events/connection.events.js';
import type { CheckResult } from './providers/provider.types.js';
import { findProvider } from './providers/registry.js';
import { ConnectionsRepository } from './repositories/connections.repository.js';

/**
 * Worker side of a check: opens the secret, calls the provider, records the outcome.
 * Runs inside the connection's account context (set by the processor). The network call
 * happens outside any database transaction.
 */
@Injectable()
export class ConnectionChecker {
  private readonly timeoutMs: number;
  private readonly allowPrivateHosts: boolean;

  constructor(
    private readonly accountDb: AccountDb,
    private readonly connections: ConnectionsRepository,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
    @Inject(SECRET_OPENER) private readonly opener: SecretOpener,
    config: ConfigService<Env, true>,
  ) {
    this.timeoutMs = config.get('CONNECTION_CHECK_TIMEOUT_MS', { infer: true });
    this.allowPrivateHosts = config.get('CONNECTIONS_ALLOW_PRIVATE_HOSTS', { infer: true });
  }

  async check(connectionId: string, userId: string | null): Promise<CheckOutcome | null> {
    const loaded = await this.accountDb.transaction(async (tx) => {
      const connection = await this.connections.findById(tx.db, connectionId);
      const sealed = connection ? await this.connections.sealedActive(tx.db, connectionId) : undefined;
      return connection ? { connection, sealed } : undefined;
    });
    if (!loaded) return null;
    const { connection, sealed } = loaded;
    const provider = findProvider(connection.provider_key);

    let result: CheckResult;
    if (!provider || !sealed) {
      result = { status: 'error', reason: 'SECRET_UNAVAILABLE' };
    } else {
      let secret: Record<string, string> | undefined;
      try {
        const plain = this.opener.open(
          { ciphertext: sealed.ciphertext, wrappedKey: sealed.wrapped_key, kekId: sealed.kek_id },
          credentialAad(connection.account_id, connection.project_id, sealed.id),
        );
        secret = JSON.parse(plain.toString('utf8')) as Record<string, string>;
        plain.fill(0);
      } catch {
        secret = undefined;
      }
      result = secret
        ? await provider.check({
            config: connection.config,
            secret,
            timeoutMs: this.timeoutMs,
            allowPrivateHosts: this.allowPrivateHosts,
          })
        : { status: 'error', reason: 'SECRET_UNAVAILABLE' };
    }

    const outcome: CheckOutcome = {
      status: result.status,
      reason: result.reason ?? null,
      detail: result.detail?.slice(0, 300) ?? null,
    };
    await this.accountDb.transaction(async (tx) => {
      const updated = await this.connections.update(tx.db, connection.id, {
        status: outcome.status,
        status_reason: outcome.reason,
        status_detail: outcome.detail,
        last_check_at: new Date(),
        ...(result.configPatch ? { config: { ...connection.config, ...result.configPatch } } : {}),
      });
      if (!updated) return;
      await this.journal.record(tx, {
        actor: userId ? { type: 'user', id: userId } : { type: 'system', id: 'connection-check' },
        action: 'connections.check',
        target: { type: 'connection', id: connection.id },
        args: { provider: connection.provider_key },
        result: { status: outcome.status, reason: outcome.reason },
        status: 'succeeded',
      });
      if (connection.status !== outcome.status) {
        await this.outbox.add<ConnectionStatusChangedEvent>(tx, {
          type: CONNECTION_EVENTS.STATUS_CHANGED,
          payload: {
            projectId: connection.project_id,
            connectionId: connection.id,
            providerKey: connection.provider_key,
            byUserId: userId,
            from: connection.status,
            to: outcome.status,
            reason: outcome.reason,
          },
        });
      }
    });
    return outcome;
  }
}
