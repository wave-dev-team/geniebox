import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module.js';
import { MailModule } from '../mail/mail.module.js';
import { ProjectAccessGuard } from './guards/project-access.guard.js';
import { ProjectContext } from './project-context.js';
import { ProjectTasks } from './project-tasks.js';
import { AccountProjectsController, MyProjectsController, ProjectController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { ProjectsRepository } from './repositories/projects.repository.js';
import {
  SupportRequestsController,
  SupportRequestsMailer,
  SupportRequestsService,
} from './support-requests.js';

@Module({
  imports: [AccountsModule],
  controllers: [
    AccountProjectsController,
    ProjectController,
    MyProjectsController,
    SupportRequestsController,
  ],
  providers: [
    ProjectsService,
    ProjectsRepository,
    ProjectAccessGuard,
    ProjectContext,
    SupportRequestsService,
  ],
  exports: [ProjectAccessGuard, ProjectContext, ProjectsRepository, ProjectsService],
})
export class ProjectsModule {}

/** Worker side: scheduled project tasks (resume after a timed pause, purge after deletion). */
@Module({
  imports: [MailModule],
  providers: [ProjectTasks, ProjectsRepository, SupportRequestsMailer],
})
export class ProjectsWorkerModule {}
