import nodemailer from 'nodemailer';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { MailMessage, MailTransport } from '../mail.types.js';

@Injectable()
export class SmtpMailTransport implements MailTransport {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;
  private readonly from: string;

  constructor(config: ConfigService) {
    const url = new URL(config.getOrThrow<string>('SMTP_URL'));
    url.searchParams.set('connectionTimeout', '10000');
    url.searchParams.set('greetingTimeout', '10000');
    url.searchParams.set('socketTimeout', '15000');
    this.transport = nodemailer.createTransport(url.toString());
    this.from = config.getOrThrow<string>('AUTH_MAIL_FROM');
  }

  async send(message: MailMessage, id?: string) {
    await this.transport.sendMail({
      ...message,
      from: this.from,
      ...(id && { messageId: `<${id}@mail.geniebox>` }),
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
}
