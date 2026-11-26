import { type Job, UnrecoverableError } from 'bullmq';

import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { I18nService } from 'nestjs-i18n';

import type { AppClsStore } from '../../common/context/app-cls-store.js';
import { runInContext } from '../../common/context/run-in-context.js';
import { LoggedWorkerHost } from '../../queues/logged-worker-host.js';
import { QUEUES } from '../../queues/queues.js';
import { MAIL_TRANSPORT, mailJobSchema, type MailTransport } from './mail.types.js';

@Processor(QUEUES.MAIL_SEND, { concurrency: 5 })
export class MailSendProcessor extends LoggedWorkerHost {
  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    private readonly i18n: I18nService,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const parsed = mailJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(`Invalid mail job: ${parsed.error.message}`);
    }
    const { to, template, locale, params, traceId } = parsed.data;
    await runInContext(this.cls, { traceId }, async () => {
      const options = { lang: locale, args: params };
      await this.transport.send({
        to,
        subject: this.i18n.t(`mail.${template}.subject`, options),
        text: this.i18n.t(`mail.${template}.text`, options),
      });
    });
  }
}
