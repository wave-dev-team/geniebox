import type { Request } from 'express';

import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';

import { type AccountRole, hasRoleAtLeast } from '../../../common/auth/account-role.js';
import type { AppClsStore } from '../../../common/context/app-cls-store.js';
import { UserDb } from '../../../database/scoped-db.js';
import { ACCOUNT_ERRORS, AccountException } from '../accounts.errors.js';
import { MembersRepository } from '../repositories/members.repository.js';
import { ACCOUNT_ROLE_KEY } from './require-account-role.decorator.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves `:accountId` for routes under /accounts/:accountId: the caller must be a member.
 * Puts accountId and the caller's role into CLS, so AccountDb and RLS scope everything after.
 * Membership is read from the database on every request.
 */
@Injectable()
export class AccountAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly userDb: UserDb,
    private readonly members: MembersRepository,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const accountId = context.switchToHttp().getRequest<Request>().params.accountId;
    if (typeof accountId !== 'string' || !UUID.test(accountId)) {
      throw new AccountException(ACCOUNT_ERRORS.ACCOUNT_NOT_FOUND);
    }
    // RLS lets a user read their own memberships across accounts.
    const access = await this.userDb.transaction(async (tx) => {
      const role = await this.members.findRole(tx.db, accountId, tx.userId);
      const account = role
        ? await tx.db
            .selectFrom('accounts')
            .select(['blocked_at', 'blocked_reason'])
            .where('id', '=', accountId)
            .executeTakeFirst()
        : undefined;
      return { role, account };
    });
    const role = access.role;
    if (!role) {
      throw new AccountException(ACCOUNT_ERRORS.ACCOUNT_NOT_FOUND);
    }
    // Blocked by the platform: members see only the reason, nothing else opens.
    if (access.account?.blocked_at) {
      throw new AccountException(ACCOUNT_ERRORS.ACCOUNT_BLOCKED, {
        details: { blockedAt: access.account.blocked_at, reason: access.account.blocked_reason },
      });
    }
    const required = this.reflector.getAllAndOverride<AccountRole | undefined>(ACCOUNT_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && !hasRoleAtLeast(role, required)) {
      throw new AccountException(ACCOUNT_ERRORS.ACCOUNT_ROLE_REQUIRED, {
        messageArgs: { role: required },
      });
    }
    this.cls.set('accountId', accountId);
    this.cls.set('accountRole', role);
    return true;
  }
}
