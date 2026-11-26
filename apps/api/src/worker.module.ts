import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';

import { CoreModule } from './core.module.js';
import { ChatWorkerModule } from './modules/chat/chat.module.js';
import { StreamPublisherModule } from './modules/stream/stream.module.js';
import { TasksWorkerModule } from './modules/tasks/tasks.module.js';
import { OutboxWorkerModule } from './outbox/outbox-worker.module.js';
import { SchedulingModule } from './scheduling/scheduling.module.js';

@Module({
  imports: [
    CoreModule,
    StreamPublisherModule,
    SchedulingModule,
    ConditionalModule.registerWhen(OutboxWorkerModule, (env) => Boolean(env.LLM_BASE_URL), { debug: false }),
    ConditionalModule.registerWhen(ChatWorkerModule, (env) => Boolean(env.LLM_BASE_URL), { debug: false }),
    ConditionalModule.registerWhen(TasksWorkerModule, (env) => Boolean(env.LLM_BASE_URL), { debug: false }),
  ],
})
export class WorkerModule {}
