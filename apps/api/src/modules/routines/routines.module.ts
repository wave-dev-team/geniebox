import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { TasksDataModule } from '../tasks/tasks.module.js';
import { RoutinesController } from './routines.controller.js';
import { RoutinesService } from './routines.service.js';

@Module({
  imports: [DatabaseModule, TasksDataModule],
  providers: [RoutinesService],
  exports: [RoutinesService],
})
export class RoutinesDataModule {}

@Module({ imports: [RoutinesDataModule], controllers: [RoutinesController], exports: [RoutinesDataModule] })
export class RoutinesModule {}
