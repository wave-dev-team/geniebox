import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../common/context/app-cls-store.js';
import { AccountContextMissingException } from '../../common/exceptions/index.js';
import { AccountContext, type Actor } from '../accounts/account-context.js';

export interface ProjectActor extends Actor {
  projectId: string;
}

/** Who acts in which project (set by AccountAccessGuard + ProjectAccessGuard). */
@Injectable()
export class ProjectContext {
  constructor(
    private readonly account: AccountContext,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  actor(): ProjectActor {
    const projectId = this.cls.get('projectId');
    // Same failure class as a missing account: a route forgot its guard.
    if (!projectId) throw new AccountContextMissingException();
    return { ...this.account.actor(), projectId };
  }
}
