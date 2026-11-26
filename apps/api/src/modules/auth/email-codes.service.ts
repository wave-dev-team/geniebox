import { createHmac, randomInt } from 'node:crypto';

import nodemailer from 'nodemailer';

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nContext, I18nService } from 'nestjs-i18n';

import { localeSchema } from '@workspace/types';

import { AuthRedis } from './auth-redis.js';

export type EmailPurpose = 'login' | 'reset' | 'verify';

const codeTtl = 10 * 60;
const resendSeconds = 60;
const issueScript = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
redis.call('HSET', KEYS[1], 'digest', ARGV[1], 'attempts', 0)
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`;
const consumeScript = `
local stored = redis.call('HGET', KEYS[1], 'digest')
if not stored then return 0 end
if redis.call('HINCRBY', KEYS[1], 'attempts', 1) > 5 then
  redis.call('DEL', KEYS[1])
  return 0
end
if stored ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1
`;
const discardScript = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1], KEYS[2])
`;

@Injectable()
export class EmailCodesService {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;
  private readonly from: string;
  private readonly key: string;

  constructor(
    private readonly redis: AuthRedis,
    private readonly i18n: I18nService,
    config: ConfigService,
  ) {
    this.transport = nodemailer.createTransport(config.getOrThrow<string>('SMTP_URL'));
    this.from = config.getOrThrow<string>('AUTH_MAIL_FROM');
    this.key = config.getOrThrow<string>('AUTH_IDENTITY_SECRET');
  }

  emailKey(email: string) {
    return this.hash(`identity:${email}`);
  }

  async send(purpose: EmailPurpose, email: string, preferredLocale?: string) {
    const code = String(randomInt(1_000_000)).padStart(6, '0');
    const { key, digest } = this.keys(purpose, email, code);
    const client = await this.redis.get();
    const cooldown = `${key}:cooldown`;
    if ((await client.eval(issueScript, 2, key, cooldown, digest, resendSeconds, codeTtl)) !== 1) return;

    try {
      const lang = localeSchema.safeParse(preferredLocale ?? I18nContext.current()?.lang).data ?? 'ru';
      await this.transport.sendMail({
        from: this.from,
        to: email,
        subject: this.i18n.translate(`auth.${purpose}.subject`, { lang }),
        text: this.i18n.translate(`auth.${purpose}.body`, { lang, args: { code } }),
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    } catch {
      await client.eval(discardScript, 2, key, cooldown, digest);
      throw new ServiceUnavailableException();
    }
  }

  async consume(purpose: EmailPurpose, email: string, code: string) {
    const { key, digest } = this.keys(purpose, email, code);
    return (await (await this.redis.get()).eval(consumeScript, 1, key, digest)) === 1;
  }

  private hash(value: string) {
    return createHmac('sha256', this.key).update(value).digest('hex');
  }

  private keys(purpose: EmailPurpose, email: string, code: string) {
    const key = `auth:email-code:{${this.emailKey(email)}}:${purpose}`;
    return { key, digest: this.hash(`${key}:${code}`) };
  }
}
