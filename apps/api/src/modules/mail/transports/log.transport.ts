import { Injectable, Logger } from '@nestjs/common';

import type { MailMessage, MailTransport } from '../mail.types.js';

@Injectable()
export class LogMailTransport implements MailTransport {
  private readonly logger = new Logger(LogMailTransport.name);

  async send(_message: MailMessage, id?: string) {
    this.logger.log({ mailId: id }, 'Mail captured by log transport');
  }
}
