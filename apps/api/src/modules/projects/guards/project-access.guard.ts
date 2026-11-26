import type { Request } from 'express';

import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../../common/context/app-cls-store.js';
import { AccountDb } from '../../../database/scoped-db.js';
import { PROJECT_ERRORS, ProjectException } from '../projects.errors.js';
import { ProjectsRepository } from '../repositories/projects.repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves `:projectId` inside the account already resolved by AccountAccessGuard (list it
 * after that guard). RLS limits the lookup to the account, so another account's project id
 * yields the same 404 as an unknown one. Puts projectId into CLS.
 */
@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(
    private readonly accountDb: AccountDb,
    private readonly projects: ProjectsRepository,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const projectId = context.switchToHttp().getRequest<Request>().params.projectId;
    if (typeof projectId !== 'string' || !UUID.test(projectId)) {
      throw new ProjectException(PROJECT_ERRORS.PROJECT_NOT_FOUND);
    }
    const project = await this.accountDb.transaction((tx) => this.projects.findById(tx.db, projectId));
    if (!project) {
      throw new ProjectException(PROJECT_ERRORS.PROJECT_NOT_FOUND);
    }
    this.cls.set('projectId', projectId);
    return true;
  }
}
