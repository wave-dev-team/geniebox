import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { JournalModule } from '../../journal/journal.module.js';
import { AccountsDataModule } from '../accounts/accounts-data.module.js';
import { TasksDataModule } from '../tasks/tasks.module.js';
import { ActionsController } from './actions.controller.js';
import { ReportDecisionsService } from './report-decisions.service.js';

@Module({
  imports: [DatabaseModule, AccountsDataModule, TasksDataModule, JournalModule],
  controllers: [ActionsController],
  providers: [ReportDecisionsService],
})
export class ActionsModule {}
