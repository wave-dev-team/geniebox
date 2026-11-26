import { createTransport, type Transporter } from 'nodemailer';

import type { MailTransport, RenderedMail } from '../mail.types.js';

export class SmtpMailTransport implements MailTransport {
  private readonly transporter: Transporter;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transporter = createTransport(url);
  }

  async send(mail: RenderedMail): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  }
}
