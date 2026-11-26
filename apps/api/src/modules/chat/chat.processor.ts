import { type Job, UnrecoverableError } from 'bullmq';

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import type { RequestContext } from '../../database/tenant-db.js';
import { modelAttempts } from '../runtime/runtime.service.js';
import type { ChatJob } from './chat.repository.js';
import { ChatService } from './chat.service.js';
import { chatQueue } from './chat-queue.js';

@Processor(chatQueue, { concurrency: 1 })
export class ChatProcessor extends WorkerHost {
  private readonly logger = new Logger(ChatProcessor.name);

  constructor(
    private readonly chat: ChatService,
    private readonly context: ClsService<RequestContext>,
  ) {
    super();
  }

  async process(job: Job<ChatJob>) {
    const finalAttempt = job.attemptsMade + 1 >= modelAttempts;
    await this.context.runWith({ tenantId: job.data.tenantId }, async () => {
      try {
        await this.chat.generate(job.data, finalAttempt);
      } catch (error) {
        if (error instanceof UnrecoverableError) throw error;
        throw new Error('Model generation failed');
      }
    });
  }

  @OnWorkerEvent('failed')
  failed(job: Job<ChatJob> | undefined) {
    if (job)
      this.logger.warn(
        { traceId: job.data.traceId, turnId: job.data.turnId, attempt: job.attemptsMade },
        'Chat job failed',
      );
  }

  @OnWorkerEvent('error')
  error() {
    this.logger.error('Chat worker unavailable');
  }
}
