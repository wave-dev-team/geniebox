import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AccountsDataModule } from '../accounts/accounts-data.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { ActionsController } from './actions.controller.js';
import { ReportDecisionsService } from './report-decisions.service.js';

@Module({
  imports: [DatabaseModule, AccountsDataModule, TasksModule],
  controllers: [ActionsController],
  providers: [ReportDecisionsService],
})
export class ActionsModule {}
