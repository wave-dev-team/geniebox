import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MailService } from './mail.service.js';
import { mailTransportToken } from './mail.types.js';
import { MailEnvelope } from './mail-envelope.js';
import { LogMailTransport } from './transports/log.transport.js';
import { MemoryMailTransport } from './transports/memory.transport.js';
import { SmtpMailTransport } from './transports/smtp.transport.js';

@Module({
  providers: [
    MailService,
    MailEnvelope,
    {
      provide: mailTransportToken,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const mode = config.get('MAIL_TRANSPORT');
        if (mode === 'memory') return new MemoryMailTransport();
        if (mode === 'log') return new LogMailTransport();
        return new SmtpMailTransport(config);
      },
    },
  ],
  exports: [MailService, MailEnvelope],
})
export class MailModule {}
