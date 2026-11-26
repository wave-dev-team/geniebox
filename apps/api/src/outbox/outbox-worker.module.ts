import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';

import { DatabaseModule } from '../database/database.module.js';
import { MailQueueModule } from '../modules/mail/mail-queue.module.js';
import { ModelQueueModule } from '../queues/model-queue.module.js';
import { OutboxRelay } from './outbox-relay.service.js';

@Module({
  imports: [
    DatabaseModule,
    MailQueueModule,
    ConditionalModule.registerWhen(ModelQueueModule, (env) => Boolean(env.LLM_BASE_URL), { debug: false }),
  ],
  providers: [OutboxRelay],
})
export class OutboxWorkerModule {}
