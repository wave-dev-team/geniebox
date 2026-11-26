import { type Job, UnrecoverableError } from 'bullmq';

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { CLS_ID, ClsService } from 'nestjs-cls';

import type { RequestContext } from '../../database/tenant-db.js';
import { type ChatJob, chatJobSchema, chatQueue, modelAttempts } from '../../queues/jobs.js';
import { ChatService } from './chat.service.js';

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
    const payload = chatJobSchema.safeParse(job.data);
    if (!payload.success) throw new UnrecoverableError('Invalid job payload');
    const finalAttempt = job.attemptsMade + 1 >= modelAttempts;
    await this.context.runWith(
      { tenantId: payload.data.tenantId, [CLS_ID]: payload.data.traceId },
      async () => {
        try {
          await this.chat.generate(payload.data, finalAttempt);
        } catch (error) {
          if (error instanceof UnrecoverableError) throw error;
          throw new Error('Model generation failed');
        }
      },
    );
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
