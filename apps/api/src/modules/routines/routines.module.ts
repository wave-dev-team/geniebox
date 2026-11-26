import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { RoutinesController } from './routines.controller.js';
import { RoutinesService } from './routines.service.js';

@Module({
  imports: [DatabaseModule, TasksModule],
  controllers: [RoutinesController],
  providers: [RoutinesService],
})
export class RoutinesModule {}
