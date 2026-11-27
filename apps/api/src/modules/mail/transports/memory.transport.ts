import type { MailTransport, RenderedMail } from '../mail.types.js';

/** Tests: keeps sent mails in memory so a test can read codes and links. */
export class MemoryMailTransport implements MailTransport {
  readonly sent: RenderedMail[] = [];

  send(mail: RenderedMail): Promise<void> {
    this.sent.push(mail);
    return Promise.resolve();
  }

  lastTo(address: string): RenderedMail | undefined {
    return [...this.sent].reverse().find((mail) => mail.to === address);
  }
}
