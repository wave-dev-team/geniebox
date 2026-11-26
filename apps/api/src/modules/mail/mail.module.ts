import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';
import { QUEUE_JOB_OPTIONS, QUEUES } from '../../queues/queues.js';
import { MailService } from './mail.service.js';
import { MAIL_TRANSPORT, type MailTransport } from './mail.types.js';
import { MailSendProcessor } from './mail-send.processor.js';
import { LogMailTransport } from './transports/log.transport.js';
import { MemoryMailTransport } from './transports/memory.transport.js';
import { SmtpMailTransport } from './transports/smtp.transport.js';

const mailQueue = BullModule.registerQueue({
  name: QUEUES.MAIL_SEND,
  defaultJobOptions: QUEUE_JOB_OPTIONS[QUEUES.MAIL_SEND],
});

/** Producer: any process that needs to send mail. */
@Global()
@Module({
  imports: [mailQueue],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}

/** Consumer: worker process only. */
@Module({
  imports: [mailQueue],
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MailTransport => {
        switch (config.get('MAIL_TRANSPORT', { infer: true })) {
          case 'smtp': {
            const url = config.get('SMTP_URL', { infer: true });
            // Guaranteed by env validation; re-checked so a misconfiguration fails loudly.
            if (!url) throw new Error('SMTP_URL is required for MAIL_TRANSPORT=smtp');
            return new SmtpMailTransport(url, config.get('MAIL_FROM', { infer: true }));
          }
          case 'memory':
            return new MemoryMailTransport();
          case 'log':
            return new LogMailTransport();
        }
      },
    },
    MailSendProcessor,
  ],
  exports: [MAIL_TRANSPORT],
})
export class MailWorkerModule {}
