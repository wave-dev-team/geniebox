import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Migrator } from 'kysely/migration';
import request from 'supertest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { z } from 'zod';

import type { INestApplication } from '@nestjs/common';

import { createDb } from '../src/database/create-db.js';
import { migrationProvider } from '../src/database/migrations/index.js';
import { bootstrapRoles } from '../src/database/roles.js';

const password = 'test-current-password';
const newPassword = 'test-replacement-password';
const appPassword = 'integration-only-app-password';
const marker = 'X-Geniebox-Request';
const prefix = '/api/v1';
let app: INestApplication;
let mailOrigin: string;
const containers: StartedTestContainer[] = [];

beforeAll(async () => {
  const [db, redis, mail] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start().then((value) => {
      containers.push(value);
      return value;
    }),
    new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .start()
      .then((value) => {
        containers.push(value);
        return value;
      }),
    new GenericContainer('axllent/mailpit:v1.31.4')
      .withExposedPorts(1025, 8025)
      .start()
      .then((value) => {
        containers.push(value);
        return value;
      }),
  ]);

  const owner = createDb(db.getConnectionUri());
  try {
    await bootstrapRoles(owner, appPassword);
    const migrator = new Migrator({ db: owner, provider: migrationProvider });
    const result = await migrator.migrateToLatest();
    if (result.error) throw result.error;
  } finally {
    await owner.destroy();
  }

  const runtime = new URL(db.getConnectionUri());
  runtime.username = 'geniebox_app';
  runtime.password = appPassword;
  process.env.DATABASE_URL = runtime.toString();
  process.env.JWT_SECRET = 'integration-only-test-jwt-secret-xyz';
  process.env.AUTH_IDENTITY_SECRET = 'integration-only-test-identity-secret';
  process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  process.env.SMTP_URL = `smtp://${mail.getHost()}:${mail.getMappedPort(1025)}`;
  process.env.AUTH_MAIL_FROM = 'test@geniebox.test';
  mailOrigin = `http://${mail.getHost()}:${mail.getMappedPort(8025)}`;

  const { createApp } = await import('../src/create-app.js');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
}, 120_000);

afterAll(async () => {
  await app?.close();
  await Promise.all(containers.map((container) => container.stop()));
});

const inboxSchema = z.object({
  messages: z.array(
    z.object({ ID: z.string(), Subject: z.string(), To: z.array(z.object({ Address: z.string() })) }),
  ),
});
const mailSchema = z.object({ Text: z.string() });

async function codeFromMail(email: string, subject: string) {
  const inbox = inboxSchema.parse(await (await fetch(`${mailOrigin}/api/v1/messages`)).json());
  const message = inbox.messages.find(
    ({ Subject, To }) => Subject === subject && To.some(({ Address }) => Address === email),
  );
  if (!message) throw new Error('Expected an email from Geniebox');
  const mail = mailSchema.parse(await (await fetch(`${mailOrigin}/api/v1/message/${message.ID}`)).json());
  const code = /\b\d{6}\b/.exec(mail.Text)?.[0];
  if (!code) throw new Error('Expected a six-digit code');
  return code;
}

it('registers, verifies, updates a profile, rotates a refresh token, and recovers the password', async () => {
  const email = 'identity@geniebox.test';
  const agent = request.agent(app.getHttpServer());
  const registration = await agent
    .post(`${prefix}/auth/register`)
    .set(marker, '1')
    .send({ email, password, name: 'Test User', locale: 'en' })
    .expect(200);
  expect(registration.body).toEqual({ created: true, emailVerified: false });
  const cookies = z.array(z.string()).parse(registration.headers['set-cookie']);
  expect(cookies).toHaveLength(2);
  expect(cookies.every((cookie) => /HttpOnly.*SameSite=Lax/.test(cookie))).toBe(true);
  const refresh = cookies.find((cookie) => cookie.startsWith('geniebox_refresh='))?.split(';')[0];
  if (!refresh) throw new Error('Expected a refresh cookie');

  const code = await codeFromMail(email, 'Verify your Geniebox email address');
  await agent.post(`${prefix}/auth/email/verification/confirm`).set(marker, '1').send({ code }).expect(204);
  await agent.post(`${prefix}/auth/email/verification/confirm`).set(marker, '1').send({ code }).expect(400);
  await agent
    .get(`${prefix}/me`)
    .expect(200)
    .expect(({ body }) => {
      expect(body).toMatchObject({ email, name: 'Test User', emailVerified: true });
    });
  await agent.patch(`${prefix}/me`).send({ name: 'Cross-origin' }).expect(403);
  await agent
    .patch(`${prefix}/me`)
    .set(marker, '1')
    .set('Sec-Fetch-Site', 'cross-site')
    .send({ name: 'Cross-origin' })
    .expect(403);
  await agent
    .patch(`${prefix}/me`)
    .set(marker, '1')
    .send({ name: 'Updated', timeZone: 'Europe/Paris' })
    .expect(200)
    .expect(({ body }) => expect(body).toMatchObject({ name: 'Updated', timeZone: 'Europe/Paris' }));

  const raw = request(app.getHttpServer());
  const rotation = () => raw.post(`${prefix}/auth/refresh`).set(marker, '1').set('Cookie', refresh);
  const rotated = await Promise.all([rotation(), rotation()]);
  expect(rotated.map((result) => result.status).sort()).toEqual([204, 409]);

  await raw.post(`${prefix}/auth/password/forgot`).set(marker, '1').send({ email }).expect(204);
  const resetCode = await codeFromMail(email, 'Reset your Geniebox password');
  await raw
    .post(`${prefix}/auth/password/reset`)
    .set(marker, '1')
    .send({ email, code: resetCode, newPassword })
    .expect(204);
  await agent.get(`${prefix}/me`).expect(401);
  await agent.post(`${prefix}/auth/login`).set(marker, '1').send({ email, password }).expect(401);
  await agent
    .post(`${prefix}/auth/login`)
    .set(marker, '1')
    .send({ email, password: newPassword })
    .expect(200);
}, 30_000);

it('signs up by email code and allows the current device to set a password', async () => {
  const email = 'passwordless@geniebox.test';
  const agent = request.agent(app.getHttpServer());
  await agent
    .post(`${prefix}/auth/email-code`)
    .set(marker, '1')
    .set('Accept-Language', 'en')
    .send({ email })
    .expect(204);
  const code = await codeFromMail(email, 'Geniebox sign-in code');
  await agent
    .post(`${prefix}/auth/email-code/verify`)
    .set(marker, '1')
    .send({ email, code })
    .expect(200, { created: true, emailVerified: true });
  await agent
    .get(`${prefix}/me`)
    .expect(200)
    .expect(({ body }) => expect(body.hasPassword).toBe(false));
  await agent.post(`${prefix}/auth/password/change`).set(marker, '1').send({ newPassword }).expect(204);
  await agent
    .get(`${prefix}/me`)
    .expect(200)
    .expect(({ body }) => expect(body.hasPassword).toBe(true));
  await agent
    .get(`${prefix}/me/sessions`)
    .expect(200)
    .expect(({ body }) => {
      expect(body).toEqual([expect.objectContaining({ current: true })]);
    });
  await agent.post(`${prefix}/auth/logout-all`).set(marker, '1').expect(204);
  await agent.get(`${prefix}/me`).expect(401);
}, 30_000);

it('revokes an unverified password when the mailbox owner signs in by code', async () => {
  const email = 'claim@geniebox.test';
  const pending = request.agent(app.getHttpServer());
  const owner = request.agent(app.getHttpServer());
  await pending
    .post(`${prefix}/auth/register`)
    .set(marker, '1')
    .send({ email, password, name: 'Pending User', locale: 'en' })
    .expect(200);
  await owner.post(`${prefix}/auth/email-code`).set(marker, '1').send({ email }).expect(204);
  const code = await codeFromMail(email, 'Geniebox sign-in code');
  await owner
    .post(`${prefix}/auth/email-code/verify`)
    .set(marker, '1')
    .send({ email, code })
    .expect(200, { created: false, emailVerified: true });
  await owner
    .get(`${prefix}/me`)
    .expect(200)
    .expect(({ body }) => expect(body.hasPassword).toBe(false));
  await pending.get(`${prefix}/me`).expect(401);
  await pending.post(`${prefix}/auth/login`).set(marker, '1').send({ email, password }).expect(401);
});
