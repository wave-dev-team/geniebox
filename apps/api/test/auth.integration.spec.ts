import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Migrator } from 'kysely/migration';
import request from 'supertest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { z } from 'zod';

import type { INestApplication } from '@nestjs/common';

import { chatHistorySchema, taskPageSchema, workTaskSchema } from '@workspace/types';

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

const modelRequests: unknown[] = [];
let rejectedTaskRun = false;
const modelServer = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const input = z
    .object({
      messages: z.array(z.object({ role: z.string(), content: z.string() })),
      response_format: z.unknown().optional(),
    })
    .parse(JSON.parse(body));
  if (input.messages.at(-1)?.content === 'Task retry regression' && !rejectedTaskRun) {
    rejectedTaskRun = true;
    res.writeHead(400);
    res.end();
    return;
  }
  modelRequests.push(input);
  const content = input.response_format
    ? '{"indexes":[0]}'
    : input.messages[0]?.content.includes('specialist contributing')
      ? 'Specialist assessment'
      : 'Manager reply';
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
  res.end('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3}}\n\ndata: [DONE]\n\n');
});

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

  await new Promise<void>((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
  const address = modelServer.address();
  if (!address || typeof address === 'string') throw new Error('Model stub port unavailable');
  process.env.LLM_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.LLM_MODEL = 'integration-model';
  const { createApp } = await import('../src/create-app.js');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
}, 120_000);

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => modelServer.close(() => resolve()));
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

it('isolates agents and turns, executes delegation and skips paused agents', async () => {
  await request(app.getHttpServer()).get(`${prefix}/chat`).expect(401);
  const alice = request.agent(app.getHttpServer());
  const bob = request.agent(app.getHttpServer());
  await Promise.all(
    [alice, bob].map((account, index) =>
      account
        .post(`${prefix}/auth/register`)
        .set(marker, '1')
        .send({ email: `agent-test-${index}@geniebox.test`, password, name: 'Test Owner', locale: 'en' })
        .expect(200),
    ),
  );
  const agent = await alice
    .post(`${prefix}/agents`)
    .set(marker, '1')
    .send({ name: 'Metrics specialist', instructions: 'Review checkout conversion', enabled: true })
    .expect(201);
  const id = z.uuid().parse(agent.body.id);
  await bob.get(`${prefix}/agents`).expect(200, []);
  await bob.patch(`${prefix}/agents/${id}`).set(marker, '1').send({ enabled: false }).expect(404);

  async function completed(turnId: string) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const history = await alice.get(`${prefix}/chat`).expect(200);
      const turn = chatHistorySchema.parse(history.body).turns.find(({ id }) => id === turnId);
      if (turn && turn.status !== 'pending') return turn;
      await sleep(100);
    }
    throw new Error('The chat worker did not finish');
  }

  const turn = { id: randomUUID(), message: 'Check checkout conversion for client@example.com' };
  await alice.post(`${prefix}/chat`).set(marker, '1').send(turn).expect(202);
  await alice.post(`${prefix}/chat`).set(marker, '1').send(turn).expect(202);
  expect(await completed(turn.id)).toMatchObject({
    answer: 'Manager reply',
    status: 'completed',
    tasks: [{ agentId: id, status: 'completed', result: 'Specialist assessment' }],
  });
  expect(modelRequests).toHaveLength(3);
  expect(JSON.stringify(modelRequests)).toContain('[email]');
  expect(JSON.stringify(modelRequests)).not.toContain('client@example.com');
  const foreign = await bob.get(`${prefix}/chat`).expect(200);
  expect(chatHistorySchema.parse(foreign.body).turns).toEqual([]);

  await alice.patch(`${prefix}/agents/${id}`).set(marker, '1').send({ enabled: false }).expect(200);
  const followUp = { id: randomUUID(), message: 'Кратко повтори ответ' };
  await alice.post(`${prefix}/chat`).set(marker, '1').send(followUp).expect(202);
  expect(await completed(followUp.id)).toMatchObject({ status: 'completed', tasks: [] });
  expect(modelRequests).toHaveLength(4);
  expect(JSON.stringify(modelRequests.at(-1))).toContain('Manager reply');
}, 30_000);

it('manages personal tasks, runs assigned tasks and lists chat assignments in the same activity', async () => {
  const alice = request.agent(app.getHttpServer());
  const bob = request.agent(app.getHttpServer());
  for (const [index, account] of [alice, bob].entries()) {
    await account
      .post(`${prefix}/auth/register`)
      .set(marker, '1')
      .send({ email: `task-test-${index}@geniebox.test`, password, name: 'Task Owner', locale: 'en' })
      .expect(200);
  }

  const url = `${prefix}/tasks`;
  await request(app.getHttpServer()).get(url).expect(401);
  const personal = {
    id: randomUUID(),
    title: 'Review checkout notes',
    description: 'Look through experiment results',
    dueOn: '2030-01-15',
    agentId: null,
  };
  const created = await alice.post(url).set(marker, '1').send(personal).expect(201);
  expect(created.body).toMatchObject({ ...personal, status: 'planned', turnId: null });
  await alice.post(url).set(marker, '1').send(personal).expect(201);
  await alice.get(`${url}/counts`).expect(200, { active: 1, done: 0 });
  await bob.get(url).expect(200, { tasks: [], nextCursor: null });
  await bob.get(`${url}/${personal.id}`).expect(404);
  await bob.patch(`${url}/${personal.id}`).set(marker, '1').send({ title: 'inaccessible' }).expect(404);

  const renamed = await alice
    .patch(`${url}/${personal.id}`)
    .set(marker, '1')
    .send({ title: 'Review test results', dueOn: null })
    .expect(200);
  expect(renamed.body).toMatchObject({ title: 'Review test results', dueOn: null });
  const action = (taskId: string, action: string) =>
    alice.post(`${url}/${taskId}/actions`).set(marker, '1').send({ action });
  expect((await action(personal.id, 'start').expect(200)).body.status).toBe('running');
  await action(personal.id, 'retry').expect(409);
  expect((await action(personal.id, 'complete').expect(200)).body.status).toBe('done');
  await alice.get(url).expect(200, { tasks: [], nextCursor: null });

  const agent = await alice
    .post(`${prefix}/agents`)
    .set(marker, '1')
    .send({ name: 'Task specialist', instructions: 'Review checkout data', enabled: true })
    .expect(201);
  const agentId = z.uuid().parse(agent.body.id);
  await bob
    .post(url)
    .set(marker, '1')
    .send({ ...personal, agentId })
    .expect(409);
  const assigned = {
    id: randomUUID(),
    title: 'Evaluate the mobile checkout',
    description: '',
    dueOn: null,
    agentId,
  };
  await alice.post(url).set(marker, '1').send(assigned).expect(201);

  async function waitFor<T>(fetch: () => Promise<T>, ready: (result: T) => boolean) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const result = await fetch();
      if (ready(result)) return result;
      await sleep(100);
    }
    throw new Error('The worker did not finish');
  }

  const result = await waitFor(
    async () => {
      const response = await alice.get(`${url}/${assigned.id}`).expect(200);
      return workTaskSchema.parse(response.body);
    },
    (task) => task.status === 'done',
  );
  expect(result).toMatchObject({ agentId, result: 'Specialist assessment' });

  const turnId = randomUUID();
  await alice
    .post(`${prefix}/chat`)
    .set(marker, '1')
    .send({ id: turnId, message: 'Ask the specialist about checkout' })
    .expect(202);
  const filtered = await waitFor(
    async () => {
      const response = await alice.get(`${url}?tab=done&agentId=${agentId}`).expect(200);
      return taskPageSchema.parse(response.body);
    },
    (page) => page.tasks.length === 2,
  );
  expect(filtered.tasks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: assigned.id, turnId: null }),
      expect.objectContaining({ turnId, agentId, result: 'Specialist assessment' }),
    ]),
  );
  await alice.get(`${url}/counts?agentId=${agentId}`).expect(200, { active: 0, done: 2 });
  const retryable = { ...assigned, id: randomUUID(), title: 'Task retry regression' };
  await alice.post(url).set(marker, '1').send(retryable).expect(201);
  const readRetryable = async () =>
    workTaskSchema.parse((await alice.get(`${url}/${retryable.id}`).expect(200)).body);
  await waitFor(readRetryable, (task) => task.status === 'failed');
  await action(retryable.id, 'retry').expect(200);
  expect(await waitFor(readRetryable, (task) => task.status === 'done')).toMatchObject({
    result: 'Specialist assessment',
  });
  const cancellable = { ...personal, id: randomUUID() };
  await alice.post(url).set(marker, '1').send(cancellable).expect(201);
  expect((await action(cancellable.id, 'cancel').expect(200)).body.status).toBe('cancelled');
  await action(cancellable.id, 'start').expect(409);
  await bob.get(`${url}?tab=done`).expect(200, { tasks: [], nextCursor: null });
}, 30_000);
