import { Logger } from '@nestjs/common';

import type { MailTransport, RenderedMail } from '../mail.types.js';

/** Development only (rejected in production by env validation): prints the whole mail. */
export class LogMailTransport implements MailTransport {
  private readonly logger = new Logger('Mail');

  send(mail: RenderedMail): Promise<void> {
    this.logger.log(`\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`);
    return Promise.resolve();
  }
}
