import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { AgentActionsService } from './agent-actions.service.js';
import { AgentCatalogView } from './agent-catalog.view.js';
import { AgentHiring } from './agent-hiring.js';
import { AgentCatalogController, AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';
import { AgentsWorker } from './agents-worker.js';
import { AgentsRepository } from './repositories/agents.repository.js';

@Module({
  imports: [AccountsModule, ProjectsModule],
  controllers: [AgentCatalogController, AgentsController],
  providers: [AgentsService, AgentActionsService, AgentHiring, AgentsRepository, AgentCatalogView],
  exports: [AgentsService],
})
export class AgentsModule {}

/** Worker side: manager of new projects, onboarding team, probation and timed pauses. */
@Module({
  providers: [AgentsWorker, AgentHiring, AgentsRepository],
})
export class AgentsWorkerModule {}
