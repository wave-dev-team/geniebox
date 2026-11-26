import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module.js';
import { ProjectAccessGuard } from './guards/project-access.guard.js';
import { ProjectContext } from './project-context.js';
import { ProjectTasks } from './project-tasks.js';
import { AccountProjectsController, MyProjectsController, ProjectController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { ProjectsRepository } from './repositories/projects.repository.js';

@Module({
  imports: [AccountsModule],
  controllers: [AccountProjectsController, ProjectController, MyProjectsController],
  providers: [ProjectsService, ProjectsRepository, ProjectAccessGuard, ProjectContext],
  exports: [ProjectAccessGuard, ProjectContext, ProjectsRepository, ProjectsService],
})
export class ProjectsModule {}

/** Worker side: scheduled project tasks (resume after a timed pause, purge after deletion). */
@Module({
  providers: [ProjectTasks, ProjectsRepository],
})
export class ProjectsWorkerModule {}
