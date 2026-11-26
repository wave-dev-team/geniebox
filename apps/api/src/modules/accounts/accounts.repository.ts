import { randomUUID } from 'node:crypto';

import { sql, type Transaction } from 'kysely';

import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { workspaceSchema } from '@workspace/types';

import { type RequestContext, TenantDb } from '../../database/tenant-db.js';
import type { DB } from '../../database/types.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import type { MailJob } from '../mail/mail.types.js';
import type { Identity } from '../users/repositories/users.repository.js';

@Injectable()
export class AccountsRepository {
  constructor(
    private readonly db: TenantDb,
    private readonly context: ClsService<RequestContext>,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
  ) {}

  async list(identity: Identity) {
    return this.inScope(identity.tenantId, async (tx) => {
      await sql`select set_config('app.identity_tenant_id', ${identity.tenantId}, true),
                      set_config('app.identity_user_id', ${identity.userId}, true)`.execute(tx);
      const rows = await tx
        .selectFrom('workspace_members as m')
        .innerJoin('workspaces as w', 'w.id', 'm.tenant_id')
        .select(['w.id', 'w.name', 'm.role'])
        .where('m.home_tenant_id', '=', identity.tenantId)
        .where('m.user_id', '=', identity.userId)
        .orderBy('m.created_at')
        .orderBy('w.id')
        .execute();
      return workspaceSchema.array().parse(rows);
    });
  }

  role(tenantId: string, identity: Identity) {
    return this.inScope(tenantId, async (tx) => {
      const member = await tx
        .selectFrom('workspace_members')
        .select('role')
        .where('tenant_id', '=', tenantId)
        .where('home_tenant_id', '=', identity.tenantId)
        .where('user_id', '=', identity.userId)
        .executeTakeFirst();
      return member?.role;
    });
  }

  rename(tenantId: string, userId: string, name: string) {
    const traceId = this.context.getId() ?? randomUUID();
    return this.inScope(tenantId, async (tx) => {
      await tx.updateTable('workspaces').set({ name }).where('id', '=', tenantId).executeTakeFirst();
      await this.journal.append(tx, {
        tenantId,
        traceId,
        targetId: tenantId,
        action: 'workspace.renamed',
        actor: { kind: 'user', id: userId, role: 'owner' },
      });
    });
  }

  saveInvitation(tenantId: string, email: string, tokenHash: string, expiresAt: Date, mail: MailJob) {
    return this.inScope(tenantId, async (tx) => {
      await tx
        .insertInto('workspace_invitations')
        .values({
          tenant_id: tenantId,
          email,
          token_hash: tokenHash,
          expires_at: expiresAt,
        })
        .execute();
      await this.outbox.enqueue(tx, { type: 'mail.requested', payload: mail });
    });
  }

  async join(identity: Identity, email: string, tokenHash: string) {
    const traceId = this.context.getId() ?? randomUUID();
    const invitation = await this.inScope(identity.tenantId, async (tx) => {
      await sql`select set_config('app.invite_hash', ${tokenHash}, true)`.execute(tx);
      return tx
        .selectFrom('workspace_invitations')
        .select('tenant_id')
        .where('token_hash', '=', tokenHash)
        .where('email', '=', email)
        .executeTakeFirst();
    });
    if (!invitation) return undefined;

    return this.inScope(invitation.tenant_id, async (tx) => {
      const accepted = await tx
        .updateTable('workspace_invitations')
        .set({ accepted_at: sql`now()` })
        .where('token_hash', '=', tokenHash)
        .where('email', '=', email)
        .where('expires_at', '>', sql<Date>`now()`)
        .where('accepted_at', 'is', null)
        .returning('tenant_id')
        .executeTakeFirst();
      if (!accepted) return undefined;

      const added = await tx
        .insertInto('workspace_members')
        .values({
          tenant_id: accepted.tenant_id,
          user_id: identity.userId,
          home_tenant_id: identity.tenantId,
          role: 'member',
        })
        .onConflict((conflict) => conflict.columns(['tenant_id', 'user_id']).doNothing())
        .returning('user_id')
        .executeTakeFirst();
      if (added)
        await this.journal.append(tx, {
          tenantId: accepted.tenant_id,
          traceId,
          targetId: identity.userId,
          action: 'workspace.member_joined',
          actor: { kind: 'user', id: identity.userId, role: 'member' },
        });
      return accepted.tenant_id;
    });
  }

  listMembers(tenantId: string) {
    return this.inScope(tenantId, (tx) =>
      tx
        .selectFrom('workspace_members')
        .select(['role', 'user_id', 'home_tenant_id'])
        .where('tenant_id', '=', tenantId)
        .orderBy('created_at')
        .orderBy('user_id')
        .execute(),
    );
  }

  private inScope<T>(tenantId: string, operation: (tx: Transaction<DB>) => Promise<T>) {
    return this.context.runWith({ tenantId }, () => this.db.transaction(operation));
  }
}
