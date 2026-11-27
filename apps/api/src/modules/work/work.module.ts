import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ConversationsService } from './conversations.service.js';
import { DecisionsService } from './decisions.service.js';
import { ConversationsRepository } from './repositories/conversations.repository.js';
import { DecisionsRepository } from './repositories/decisions.repository.js';
import { MessageActionsRepository } from './repositories/message-actions.repository.js';
import { RoutinesRepository } from './repositories/routines.repository.js';
import { TasksRepository } from './repositories/tasks.repository.js';
import { RoutinesService } from './routines.service.js';
import { TasksService } from './tasks.service.js';
import {
  ConversationsController,
  CountersController,
  DecisionsController,
  TasksController,
} from './work.controller.js';

const REPOSITORIES = [
  TasksRepository,
  RoutinesRepository,
  DecisionsRepository,
  ConversationsRepository,
  MessageActionsRepository,
];

/** Repositories shared with the runtime worker. */
@Module({ providers: REPOSITORIES, exports: REPOSITORIES })
export class WorkDataModule {}

/** Tasks, routines, decisions and conversations of the public API. */
@Module({
  imports: [AccountsModule, ProjectsModule, WorkDataModule],
  controllers: [TasksController, DecisionsController, ConversationsController, CountersController],
  providers: [TasksService, RoutinesService, DecisionsService, ConversationsService],
  // Buttons run the same services as the panel (actions module).
  exports: [TasksService, RoutinesService, DecisionsService, ConversationsService],
})
export class WorkModule {}
