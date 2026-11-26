import nodemailer from 'nodemailer';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.transport = nodemailer.createTransport(config.getOrThrow<string>('SMTP_URL'));
    this.from = config.getOrThrow<string>('AUTH_MAIL_FROM');
  }

  async send(message: { to: string; subject: string; text: string }) {
    await this.transport.sendMail({
      ...message,
      from: this.from,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
}
