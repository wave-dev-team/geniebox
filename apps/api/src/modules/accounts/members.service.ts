import { Injectable } from '@nestjs/common';

import { type AccountRole, type AssignableRole, hasRoleAtLeast } from '../../common/auth/account-role.js';
import { AccountDb, type AccountTx } from '../../database/scoped-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { AccountContext, type Actor } from './account-context.js';
import { ACCOUNT_ERRORS, AccountException } from './accounts.errors.js';
import {
  ACCOUNT_EVENTS,
  type MemberEvent,
  type MemberRoleChangedEvent,
  type OwnershipTransferredEvent,
} from './events/account.events.js';
import { MembersRepository, type MemberView } from './repositories/members.repository.js';

/**
 * Membership rules:
 * - the owner role changes only through ownership transfer (by the owner);
 * - admins manage members; changing or removing another admin requires the owner;
 * - anyone except the owner may leave the account.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly accountDb: AccountDb,
    private readonly members: MembersRepository,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
    private readonly context: AccountContext,
  ) {}

  list(): Promise<MemberView[]> {
    return this.accountDb.transaction((tx) => this.members.list(tx.db, tx.accountId));
  }

  async changeRole(targetUserId: string, role: AssignableRole): Promise<void> {
    const actor = this.context.actor();
    await this.accountDb.transaction(async (tx) => {
      const current = await this.lockTarget(tx, targetUserId);
      if (current === 'owner') {
        throw new AccountException(ACCOUNT_ERRORS.OWNER_ROLE_IMMUTABLE);
      }
      // Admins may promote members and step down themselves, but not change other admins.
      if (current === 'admin' && actor.role !== 'owner' && targetUserId !== actor.userId) {
        throw new AccountException(ACCOUNT_ERRORS.OWNER_REQUIRED);
      }
      if (current === role) {
        return;
      }
      await this.members.updateRole(tx.db, tx.accountId, targetUserId, role);
      await this.record(tx, actor, 'accounts.members.change_role', targetUserId, {
        from: current,
        to: role,
      });
      await this.outbox.add<MemberRoleChangedEvent>(tx, {
        type: ACCOUNT_EVENTS.MEMBER_ROLE_CHANGED,
        payload: {
          accountId: tx.accountId,
          userId: targetUserId,
          role,
          previousRole: current,
          byUserId: actor.userId,
        },
      });
    });
  }

  async remove(targetUserId: string): Promise<void> {
    const actor = this.context.actor();
    const leaving = targetUserId === actor.userId;
    await this.accountDb.transaction(async (tx) => {
      const current = await this.lockTarget(tx, targetUserId);
      if (current === 'owner') {
        throw new AccountException(ACCOUNT_ERRORS.OWNER_ROLE_IMMUTABLE);
      }
      if (!leaving) {
        if (!hasRoleAtLeast(actor.role, 'admin')) {
          throw new AccountException(ACCOUNT_ERRORS.ACCOUNT_ROLE_REQUIRED, {
            messageArgs: { role: 'admin' },
          });
        }
        if (current === 'admin' && actor.role !== 'owner') {
          throw new AccountException(ACCOUNT_ERRORS.OWNER_REQUIRED);
        }
      }
      await this.members.delete(tx.db, tx.accountId, targetUserId);
      await this.record(
        tx,
        actor,
        leaving ? 'accounts.members.leave' : 'accounts.members.remove',
        targetUserId,
        {
          role: current,
        },
      );
      await this.outbox.add<MemberEvent>(tx, {
        type: ACCOUNT_EVENTS.MEMBER_REMOVED,
        payload: {
          accountId: tx.accountId,
          userId: targetUserId,
          role: current,
          byUserId: actor.userId,
        },
      });
    });
  }

  /** The current owner hands over ownership and becomes an admin. */
  async transferOwnership(targetUserId: string): Promise<void> {
    const actor = this.context.actor();
    if (actor.role !== 'owner') {
      throw new AccountException(ACCOUNT_ERRORS.OWNER_REQUIRED);
    }
    if (targetUserId === actor.userId) {
      return;
    }
    await this.accountDb.transaction(async (tx) => {
      await this.lockTarget(tx, actor.userId);
      await this.lockTarget(tx, targetUserId);
      // Demote first: the single-owner index would reject two owners even mid-transaction.
      await this.members.updateRole(tx.db, tx.accountId, actor.userId, 'admin');
      await this.members.updateRole(tx.db, tx.accountId, targetUserId, 'owner');
      await this.record(tx, actor, 'accounts.ownership.transfer', targetUserId);
      await this.outbox.add<OwnershipTransferredEvent>(tx, {
        type: ACCOUNT_EVENTS.OWNERSHIP_TRANSFERRED,
        payload: { accountId: tx.accountId, fromUserId: actor.userId, toUserId: targetUserId },
      });
    });
  }

  private async lockTarget(tx: AccountTx, userId: string): Promise<AccountRole> {
    const role = await this.members.findRoleForUpdate(tx.db, tx.accountId, userId);
    if (!role) {
      throw new AccountException(ACCOUNT_ERRORS.MEMBER_NOT_FOUND);
    }
    return role;
  }

  private async record(
    tx: AccountTx,
    actor: Actor,
    action: string,
    targetUserId: string,
    args?: unknown,
  ): Promise<void> {
    await this.journal.record(tx, {
      actor: { type: 'user', id: actor.userId, role: actor.role },
      action,
      target: { type: 'user', id: targetUserId },
      args,
      status: 'succeeded',
    });
  }
}
