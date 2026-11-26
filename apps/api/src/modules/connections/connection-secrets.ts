import { Inject, Injectable } from '@nestjs/common';

import { AccountDb } from '../../database/scoped-db.js';
import { SECRET_OPENER, type SecretOpener } from '../../secrets/secret-cipher.js';
import { credentialAad } from './credential-aad.js';
import { ConnectionsRepository } from './repositories/connections.repository.js';

export interface OpenedConnection {
  id: string;
  providerKey: string;
  config: Record<string, string>;
  secret: Record<string, string>;
}

/**
 * Worker side: opens a connection's active credential for the tool executor. The plaintext
 * lives only in memory of the call that asked for it; nothing is logged or returned to models.
 */
@Injectable()
export class ConnectionSecrets {
  constructor(
    private readonly accountDb: AccountDb,
    private readonly connections: ConnectionsRepository,
    @Inject(SECRET_OPENER) private readonly opener: SecretOpener,
  ) {}

  async open(connectionId: string): Promise<OpenedConnection | undefined> {
    const loaded = await this.accountDb.transaction(async (tx) => {
      const connection = await this.connections.findById(tx.db, connectionId);
      const sealed = connection ? await this.connections.sealedActive(tx.db, connectionId) : undefined;
      return connection && sealed ? { connection, sealed } : undefined;
    });
    if (!loaded) return undefined;
    const { connection, sealed } = loaded;
    try {
      const plain = this.opener.open(
        { ciphertext: sealed.ciphertext, wrappedKey: sealed.wrapped_key, kekId: sealed.kek_id },
        credentialAad(connection.account_id, connection.project_id, sealed.id),
      );
      const secret = JSON.parse(plain.toString('utf8')) as Record<string, string>;
      plain.fill(0);
      return {
        id: connection.id,
        providerKey: connection.provider_key,
        config: connection.config,
        secret,
      };
    } catch {
      return undefined;
    }
  }
}
