import { Injectable } from '@nestjs/common';

import type { MailMessage, MailTransport } from '../mail.types.js';

@Injectable()
export class MemoryMailTransport implements MailTransport {
  private readonly messages: MailMessage[] = [];

  async send(message: MailMessage) {
    this.messages.push({ ...message });
    if (this.messages.length > 100) this.messages.shift();
  }

  drain() {
    return this.messages.splice(0);
  }
}
