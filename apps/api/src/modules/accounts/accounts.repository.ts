import { sql, type Transaction } from 'kysely';

import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { workspaceSchema } from '@workspace/types';

import { type RequestContext, TenantDb } from '../../database/tenant-db.js';
import type { DB } from '../../database/types.js';
import type { Identity } from '../profile/profile.repository.js';

@Injectable()
export class AccountsRepository {
  constructor(
    private readonly db: TenantDb,
    private readonly context: ClsService<RequestContext>,
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

  rename(tenantId: string, name: string) {
    return this.inScope(tenantId, (tx) =>
      tx.updateTable('workspaces').set({ name }).where('id', '=', tenantId).executeTakeFirst(),
    );
  }

  saveInvitation(tenantId: string, email: string, tokenHash: string, expiresAt: Date) {
    return this.inScope(tenantId, (tx) =>
      tx
        .insertInto('workspace_invitations')
        .values({
          tenant_id: tenantId,
          email,
          token_hash: tokenHash,
          expires_at: expiresAt,
        })
        .executeTakeFirst(),
    );
  }

  discardInvitation(tenantId: string, tokenHash: string) {
    return this.inScope(tenantId, (tx) =>
      tx
        .deleteFrom('workspace_invitations')
        .where('token_hash', '=', tokenHash)
        .where('accepted_at', 'is', null)
        .executeTakeFirst(),
    );
  }

  async join(identity: Identity, email: string, tokenHash: string) {
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

      await tx
        .insertInto('workspace_members')
        .values({
          tenant_id: accepted.tenant_id,
          user_id: identity.userId,
          home_tenant_id: identity.tenantId,
          role: 'member',
        })
        .onConflict((conflict) => conflict.columns(['tenant_id', 'user_id']).doNothing())
        .execute();
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
