import { Global, Module } from '@nestjs/common';

import { ScheduledTaskRegistry } from './scheduled-task.registry.js';
import { ScheduledTasksService } from './scheduled-tasks.service.js';

@Global()
@Module({
  providers: [ScheduledTasksService, ScheduledTaskRegistry],
  exports: [ScheduledTasksService, ScheduledTaskRegistry],
})
export class SchedulingModule {}
