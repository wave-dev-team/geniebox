import { Global, Module } from '@nestjs/common';

import { OutboxService } from './outbox.service.js';

/** Producer side, available everywhere. The relay and processor live in OutboxWorkerModule. */
@Global()
@Module({
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
