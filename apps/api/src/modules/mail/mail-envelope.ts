import { createHmac, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { decryptSecret, encryptSecret } from '../../secrets/secret-cipher.js';
import { type MailJob, type MailMessage, mailMessageSchema } from './mail.types.js';

@Injectable()
export class MailEnvelope {
  private readonly key: Buffer;
  constructor(config: ConfigService) {
    this.key = createHmac('sha256', config.getOrThrow<string>('AUTH_IDENTITY_SECRET'))
      .update('geniebox:mail-envelope:v1')
      .digest();
  }

  seal(tenantId: string, traceId: string, expiry: Date, message: MailMessage): MailJob {
    const job = { tenantId, traceId, mailId: randomUUID(), expiresAt: expiry.toISOString() };
    return {
      ...job,
      ciphertext: encryptSecret(
        this.key,
        this.context(job),
        JSON.stringify(mailMessageSchema.parse(message)),
      ),
    };
  }

  open(job: MailJob) {
    return mailMessageSchema.parse(JSON.parse(decryptSecret(this.key, this.context(job), job.ciphertext)));
  }

  private context(job: Omit<MailJob, 'ciphertext'>) {
    return [job.tenantId, job.traceId, job.mailId, job.expiresAt];
  }
}
