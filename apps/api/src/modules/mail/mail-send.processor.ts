import { type Job, UnrecoverableError } from 'bullmq';

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { runInContext } from '../../common/context/run-in-context.js';
import type { RequestContext } from '../../database/tenant-db.js';
import { MailService } from './mail.service.js';
import { type MailJob, mailJobSchema, mailQueue } from './mail.types.js';
import { MailEnvelope } from './mail-envelope.js';

@Processor(mailQueue, { concurrency: 1 })
export class MailSendProcessor extends WorkerHost {
  private readonly logger = new Logger(MailSendProcessor.name);

  constructor(
    private readonly envelope: MailEnvelope,
    private readonly mail: MailService,
    private readonly context: ClsService<RequestContext>,
  ) {
    super();
  }

  async process(job: Job<MailJob>) {
    const input = mailJobSchema.safeParse(job.data);
    if (!input.success) throw new UnrecoverableError('Invalid mail job');
    if (Date.parse(input.data.expiresAt) <= Date.now()) return;
    return runInContext(this.context, input.data, async () => {
      let message;
      try {
        message = this.envelope.open(input.data);
      } catch {
        throw new UnrecoverableError('Invalid mail envelope');
      }
      try {
        await this.mail.send(message, input.data.mailId);
      } catch {
        throw new Error('Mail delivery failed');
      }
    });
  }

  @OnWorkerEvent('failed')
  failed(job: Job<MailJob> | undefined) {
    this.logger.warn({ mailId: job?.id, attempt: job?.attemptsMade }, 'Mail job failed');
  }

  @OnWorkerEvent('error')
  error() {
    this.logger.error('Mail worker unavailable');
  }
}
