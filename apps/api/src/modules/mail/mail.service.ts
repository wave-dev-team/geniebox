import { Inject, Injectable } from '@nestjs/common';

import { type MailMessage, type MailTransport, mailTransportToken } from './mail.types.js';

@Injectable()
export class MailService {
  constructor(@Inject(mailTransportToken) private readonly transport: MailTransport) {}

  send(message: MailMessage, id?: string) {
    return this.transport.send(message, id);
  }
}
