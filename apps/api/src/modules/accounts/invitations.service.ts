import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';

import type { AccountRole, AssignableRole } from '../../common/auth/account-role.js';
import type { AppClsStore } from '../../common/context/app-cls-store.js';
import { randomToken, sha256 } from '../../common/crypto.js';
import { DEFAULT_LOCALE, type Locale } from '../../common/i18n/locales.js';
import type { Env } from '../../config/env.schema.js';
import { AccountDb } from '../../database/scoped-db.js';
import { SystemDb } from '../../database/system-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { MailService } from '../mail/mail.service.js';
import { normalizeEmail } from '../users/email.js';
import { UsersService } from '../users/users.service.js';
import { AccountContext } from './account-context.js';
import { ACCOUNT_ERRORS, AccountException } from './accounts.errors.js';
import { ACCOUNT_EVENTS, type InvitationEvent, type MemberEvent } from './events/account.events.js';
import { AccountsRepository, type AccountWithRole } from './repositories/accounts.repository.js';
import { type InvitationRow, InvitationsRepository } from './repositories/invitations.repository.js';
import { MembersRepository } from './repositories/members.repository.js';

const DAY_MS = 86_400_000;

@Injectable()
export class InvitationsService {
  private readonly ttlMs: number;
  private readonly appUrl: string;

  constructor(
    private readonly accountDb: AccountDb,
    // SystemDb: accepting resolves the account from the token, before any account context.
    private readonly systemDb: SystemDb,
    private readonly invitations: InvitationsRepository,
    private readonly members: MembersRepository,
    private readonly accounts: AccountsRepository,
    private readonly users: UsersService,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
    private readonly mail: MailService,
    private readonly context: AccountContext,
    private readonly cls: ClsService<AppClsStore>,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('INVITATION_TTL_DAYS', { infer: true }) * DAY_MS;
    this.appUrl = config.get('APP_PUBLIC_URL', { infer: true }).replace(/\/+$/, '');
  }

  /** Invites by email; a pending invitation for the same email is replaced. */
  async create(emailInput: string, role: AssignableRole): Promise<InvitationRow> {
    const actor = this.context.actor();
    const email = normalizeEmail(emailInput);
    const token = randomToken();

    const { invitation, accountName, inviterName, locale } = await this.accountDb.transaction(async (tx) => {
      if (await this.members.findUserIdByEmail(tx.db, tx.accountId, email)) {
        throw new AccountException(ACCOUNT_ERRORS.ALREADY_MEMBER);
      }
      await this.invitations.revokePendingFor(tx.db, tx.accountId, email);
      const created = await this.invitations.insert(tx.db, {
        account_id: tx.accountId,
        email,
        role,
        token_hash: sha256(token),
        invited_by: actor.userId,
        expires_at: new Date(Date.now() + this.ttlMs),
      });
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action: 'accounts.invitations.create',
        target: { type: 'invitation', id: created.id },
        args: { role },
        status: 'succeeded',
      });
      await this.outbox.add<InvitationEvent>(tx, {
        type: ACCOUNT_EVENTS.INVITATION_CREATED,
        payload: {
          accountId: tx.accountId,
          invitationId: created.id,
          role,
          byUserId: actor.userId,
        },
      });
      const account = await this.accounts.findById(tx.db, tx.accountId);
      const inviter = (await this.members.list(tx.db, tx.accountId)).find((m) => m.userId === actor.userId);
      return {
        invitation: created,
        accountName: account?.name ?? '',
        inviterName: inviter?.displayName ?? inviter?.email ?? '',
        locale: (account?.locale ?? DEFAULT_LOCALE) as Locale,
      };
    });

    // After commit, outside the transaction: a failure surfaces to the inviter, who can retry.
    await this.mail.send({
      to: email,
      template: 'account_invitation',
      locale,
      params: {
        accountName,
        inviterName,
        link: `${this.appUrl}/invitations/accept?token=${encodeURIComponent(token)}`,
        expiresAt: invitation.expires_at.toISOString().slice(0, 10),
      },
    });
    return invitation;
  }

  listPending(): Promise<InvitationRow[]> {
    return this.accountDb.transaction((tx) => this.invitations.listPending(tx.db, tx.accountId));
  }

  async revoke(invitationId: string): Promise<void> {
    const actor = this.context.actor();
    await this.accountDb.transaction(async (tx) => {
      const revoked = await this.invitations.revoke(tx.db, tx.accountId, invitationId);
      if (!revoked) {
        throw new AccountException(ACCOUNT_ERRORS.INVITATION_NOT_FOUND);
      }
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action: 'accounts.invitations.revoke',
        target: { type: 'invitation', id: invitationId },
        status: 'succeeded',
      });
      await this.outbox.add<InvitationEvent>(tx, {
        type: ACCOUNT_EVENTS.INVITATION_REVOKED,
        payload: {
          accountId: tx.accountId,
          invitationId,
          role: revoked.role as AccountRole,
          byUserId: actor.userId,
        },
      });
    });
  }

  /**
   * Accepts with the emailed token. The signed-in user must own the invited (verified) email,
   * so a forwarded link does not let someone else in. Idempotent for an existing member.
   */
  async accept(token: string): Promise<AccountWithRole> {
    const user = await this.users.getActiveById(this.context.userId());
    if (!user.email_verified_at) {
      throw new AccountException(ACCOUNT_ERRORS.EMAIL_NOT_VERIFIED);
    }

    return this.systemDb.transaction(async (trx) => {
      const invitation = await this.invitations.findByTokenHashForUpdate(trx, sha256(token));
      if (!invitation || invitation.revoked_at) {
        throw new AccountException(ACCOUNT_ERRORS.INVITATION_NOT_FOUND);
      }
      if (invitation.email !== user.email) {
        throw new AccountException(ACCOUNT_ERRORS.INVITATION_EMAIL_MISMATCH);
      }
      const account = await this.accounts.findById(trx, invitation.account_id);
      if (!account) {
        throw new AccountException(ACCOUNT_ERRORS.INVITATION_NOT_FOUND);
      }
      const existingRole = await this.members.findRole(trx, account.id, user.id);
      if (existingRole) {
        return { ...account, role: existingRole };
      }
      if (invitation.accepted_at || invitation.expires_at.getTime() < Date.now()) {
        throw new AccountException(ACCOUNT_ERRORS.INVITATION_EXPIRED);
      }

      const role = invitation.role as AssignableRole;
      await this.members.insert(trx, account.id, user.id, role);
      await this.invitations.markAccepted(trx, invitation.id, user.id);
      const context = { db: trx, accountId: account.id, traceId: this.cls.getId() };
      await this.journal.record(context, {
        actor: { type: 'user', id: user.id, role },
        action: 'accounts.invitations.accept',
        target: { type: 'invitation', id: invitation.id },
        status: 'succeeded',
      });
      await this.outbox.add<MemberEvent>(context, {
        type: ACCOUNT_EVENTS.MEMBER_ADDED,
        payload: { accountId: account.id, userId: user.id, role, byUserId: invitation.invited_by },
      });
      return { ...account, role };
    });
  }
}
