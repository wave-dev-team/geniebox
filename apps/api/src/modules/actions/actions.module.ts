import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module.js';
import { AgentsModule } from '../agents/agents.module.js';
import { ConnectionsModule } from '../connections/connections.module.js';
import { MetricsModule } from '../metrics/metrics.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { WorkDataModule, WorkModule } from '../work/work.module.js';
import { ErrorText } from './error-text.js';
import { MessageActionsController } from './message-actions.controller.js';
import { MessageActionsService } from './message-actions.service.js';
import { PanelActions } from './panel-actions.js';
import { UserActor } from './user-actor.js';

const SHARED = [UserActor, PanelActions, MessageActionsService, ErrorText];

/**
 * Panel actions outside the panel: what a person can do, runnable as that person from
 * Message buttons and the manager's panel tools. Used by the API and the worker.
 */
@Module({
  imports: [
    AccountsModule,
    ProjectsModule,
    WorkDataModule,
    WorkModule,
    AgentsModule,
    ConnectionsModule,
    MetricsModule,
  ],
  providers: SHARED,
  exports: SHARED,
})
export class ActionsModule {}

/** API: buttons pressed in the panel. */
@Module({
  imports: [ActionsModule, AccountsModule, ProjectsModule],
  controllers: [MessageActionsController],
})
export class ActionsApiModule {}
