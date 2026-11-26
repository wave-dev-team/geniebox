import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { ModelQueueModule } from '../queues/model-queue.module.js';
import { OutboxRelay } from './outbox-relay.service.js';

@Module({ imports: [DatabaseModule, ModelQueueModule], providers: [OutboxRelay] })
export class OutboxWorkerModule {}
