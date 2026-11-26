import { Module } from '@nestjs/common';

import { MailModule } from './mail.module.js';
import { MailQueueModule } from './mail-queue.module.js';
import { MailSendProcessor } from './mail-send.processor.js';

@Module({ imports: [MailQueueModule, MailModule], providers: [MailSendProcessor] })
export class MailWorkerModule {}
