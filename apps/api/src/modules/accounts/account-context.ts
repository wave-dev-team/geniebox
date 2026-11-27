import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import type { AccountRole } from '../../common/auth/account-role.js';
import type { AppClsStore } from '../../common/context/app-cls-store.js';
import {
  AccountContextMissingException,
  UserContextMissingException,
} from '../../common/exceptions/index.js';

export interface Actor {
  userId: string;
  accountId: string;
  role: AccountRole;
}

/** Typed access to who is acting in which account (set by the guards). */
@Injectable()
export class AccountContext {
  constructor(private readonly cls: ClsService<AppClsStore>) {}

  userId(): string {
    const userId = this.cls.get('userId');
    if (!userId) throw new UserContextMissingException();
    return userId;
  }

  actor(): Actor {
    const accountId = this.cls.get('accountId');
    const role = this.cls.get('accountRole');
    if (!accountId || !role) throw new AccountContextMissingException();
    return { userId: this.userId(), accountId, role };
  }
}
