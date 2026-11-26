import type { JWTVerifyGetKey } from 'jose';
import request from 'supertest';

import { type DynamicModule, Logger, type Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';

import { ApiModule } from '../../src/api.module.js';
import { configureHttpApp } from '../../src/bootstrap/configure-http-app.js';
import type { Env } from '../../src/config/env.schema.js';
import { OidcVerifier } from '../../src/modules/auth/oidc/oidc-verifier.js';
import { ConnectionsWorkerModule } from '../../src/modules/connections/connections.module.js';
import { MailWorkerModule } from '../../src/modules/mail/mail.module.js';
import { MAIL_TRANSPORT } from '../../src/modules/mail/mail.types.js';
import type { MemoryMailTransport } from '../../src/modules/mail/transports/memory.transport.js';
import { eventually } from './helpers.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  userId: string;
  created: boolean;
}

/**
 * Public API plus the mail and connection-check workers in one process, with the in-memory
 * mail transport.
 */
export class ApiHarness {
  private constructor(
    readonly app: NestExpressApplication,
    readonly mail: MemoryMailTransport,
  ) {}

  static async create(
    oidcKeys: { google?: JWTVerifyGetKey; apple?: JWTVerifyGetKey } = {},
  ): Promise<ApiHarness> {
    const moduleRef = await Test.createTestingModule({
      imports: [ApiModule, MailWorkerModule, ConnectionsWorkerModule],
    })
      .overrideProvider(OidcVerifier)
      .useFactory({
        inject: [ConfigService],
        factory: (config: ConfigService<Env, true>) => new OidcVerifier(config, oidcKeys),
      })
      .compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    // Compiling a testing module re-installs the default logger.
    Logger.overrideLogger(false);
    configureHttpApp(app, { kind: 'public' });
    await app.init();
    return new ApiHarness(app, app.get<MemoryMailTransport>(MAIL_TRANSPORT));
  }

  http(): ReturnType<typeof request> {
    return request(this.app.getHttpServer());
  }

  get(path: string, token?: string): request.Test {
    const req = this.http().get(path);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  post(path: string, body?: object, token?: string): request.Test {
    const req = this.http().post(path).send(body);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  patch(path: string, body: object, token: string): request.Test {
    return this.http().patch(path).send(body).set('Authorization', `Bearer ${token}`);
  }

  put(path: string, body: object, token: string): request.Test {
    return this.http().put(path).set('authorization', `Bearer ${token}`).send(body);
  }

  delete(path: string, token: string): request.Test {
    return this.http().delete(path).set('Authorization', `Bearer ${token}`);
  }

  /** Waits for the worker to deliver a mail to `to` whose text matches `pattern`. */
  async mailMatch(to: string, pattern: RegExp, after = 0): Promise<string> {
    return eventually(() => {
      const mail = this.mail.sent.slice(after).find((item) => item.to === to && pattern.test(item.text));
      const match = mail ? pattern.exec(mail.text) : null;
      if (!match?.[1]) throw new Error(`no mail to ${to} matching ${String(pattern)}`);
      return Promise.resolve(match[1]);
    });
  }

  async code(to: string, after = 0): Promise<string> {
    return this.mailMatch(to, /(\d{6})/, after);
  }

  /** Signs up (or in) by email code: the account email is verified. */
  async signInWithCode(email: string): Promise<TokenPair> {
    const before = this.mail.sent.length;
    await this.post('/v1/auth/email-code', { email }).expect(202);
    const code = await this.code(email, before);
    const response = await this.post('/v1/auth/email-code/verify', { email, code }).expect(200);
    return response.body as TokenPair;
  }

  /**
   * A worker process next to this API. Its mail goes to the same in-memory transport: with two
   * transports the queue job lands in whichever worker takes it, and `mailMatch` would miss it.
   */
  async worker(imports: Array<Type | DynamicModule>): Promise<TestingModule> {
    const worker = await Test.createTestingModule({ imports })
      .overrideProvider(MAIL_TRANSPORT)
      .useValue(this.mail)
      .compile();
    Logger.overrideLogger(false);
    await worker.init();
    return worker;
  }

  async close(): Promise<void> {
    await this.app.close();
  }
}
