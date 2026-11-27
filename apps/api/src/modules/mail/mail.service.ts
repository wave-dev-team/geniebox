import type { Queue } from 'bullmq';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../common/context/app-cls-store.js';
import type { Locale } from '../../common/i18n/locales.js';
import { jobId, QUEUES } from '../../queues/queues.js';
import type { MailJob, MailTemplate } from './mail.types.js';

export interface SendMailInput {
  to: string;
  template: MailTemplate;
  locale: Locale;
  params: Record<string, string>;
}

/** Producer side: enqueues a templated mail; delivery and retries happen in the worker. */
@Injectable()
export class MailService {
  constructor(
    @InjectQueue(QUEUES.MAIL_SEND) private readonly queue: Queue<MailJob>,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async send(input: SendMailInput, eventId?: string): Promise<void> {
    await this.queue.add(
      input.template,
      { ...input, traceId: this.cls.getId() },
      eventId ? { jobId: jobId('mail', eventId) } : undefined,
    );
  }
}
