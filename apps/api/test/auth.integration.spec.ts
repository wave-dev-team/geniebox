import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

import { jest } from '@jest/globals';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Migrator } from 'kysely/migration';
import request from 'supertest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { z } from 'zod';

import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { chatHistorySchema, taskPageSchema, workTaskSchema } from '@workspace/types';

import { createDb } from '../src/database/create-db.js';
import { migrationProvider } from '../src/database/migrations/index.js';
import { bootstrapRoles } from '../src/database/roles.js';
import { type RequestContext, TenantDb } from '../src/database/tenant-db.js';
import { MetricaProvider } from '../src/modules/connections/metrica.provider.js';
import { RoutinesService } from '../src/modules/routines/routines.service.js';
import { OutboxRelay } from '../src/outbox/outbox-relay.service.js';

const password = 'test-current-password';
const newPassword = 'test-replacement-password';
const appPassword = 'integration-only-app-password';
const marker = 'X-Geniebox-Request';
const prefix = '/api/v1';
let app: INestApplication;
let worker: INestApplicationContext;
let ownerUrl: string;
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

  ownerUrl = db.getConnectionUri();
  const owner = createDb(ownerUrl);
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
  process.env.CONNECTIONS_ENCRYPTION_KEY = 'c4'.repeat(32);
  mailOrigin = `http://${mail.getHost()}:${mail.getMappedPort(8025)}`;

  await new Promise<void>((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
  const address = modelServer.address();
  if (!address || typeof address === 'string') throw new Error('Model stub port unavailable');
  process.env.LLM_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.LLM_MODEL = 'integration-model';
  process.env.LLM_INCLUDE_WORKSPACE_REPORTS = 'true';
  const { createApp } = await import('../src/create-app.js');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  const { createWorker } = await import('../src/create-worker.js');
  worker = await createWorker();
}, 120_000);

afterAll(async () => {
  await worker?.close();
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

async function codeFromMail(email: string, subject: string, pattern = /\b\d{6}\b/) {
  let message: z.infer<typeof inboxSchema>['messages'][number] | undefined;
  for (let attempt = 0; attempt < 50 && !message; attempt++) {
    const inbox = inboxSchema.parse(await (await fetch(`${mailOrigin}/api/v1/messages`)).json());
    message = inbox.messages.find(
      ({ Subject, To }) => Subject === subject && To.some(({ Address }) => Address === email),
    );
    if (!message) await sleep(100);
  }
  if (!message) throw new Error('Expected an email from Geniebox');
  const mail = mailSchema.parse(await (await fetch(`${mailOrigin}/api/v1/message/${message.ID}`)).json());
  const code = pattern.exec(mail.Text)?.[0];
  if (!code) throw new Error('Expected a code in the email');
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
  await bob
    .get(`${prefix}/agents`)
    .expect(200)
    .expect(({ body }) => {
      expect(body).toHaveLength(3);
      expect(body).toEqual(
        expect.arrayContaining([expect.objectContaining({ catalogKey: 'metrics', enabled: false })]),
      );
      expect(body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
    });
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

it('streams chat and task changes only to the authenticated owner', async () => {
  const url = `${await app.getUrl()}${prefix}/stream`;
  await request(app.getHttpServer()).get(`${prefix}/stream`).expect(401);
  const alice = request.agent(app.getHttpServer());
  const bob = request.agent(app.getHttpServer());
  const registered = await Promise.all(
    [alice, bob].map((account, index) =>
      account
        .post(`${prefix}/auth/register`)
        .set(marker, '1')
        .send({ email: `stream-test-${index}@geniebox.test`, password, name: 'Stream Owner' })
        .expect(200),
    ),
  );
  const cookies = z.array(z.string()).parse(registered[0]?.headers['set-cookie']);
  const cookie = cookies.find((value) => value.startsWith('geniebox_access='));
  if (!cookie) throw new Error('Missing session cookie');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: { cookie: cookie.split(';')[0] ?? '' },
      signal: controller.signal,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    if (!response.body) throw new Error('Missing event stream');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let events = '';
    const readUntil = async (type: string) => {
      while (!events.includes(`event: ${type}\n`)) {
        const next = await reader.read();
        if (next.done) throw new Error(`Stream closed before ${type}`);
        events += decoder.decode(next.value, { stream: true });
      }
    };
    await readUntil('ready');

    const waitForReply = async (account: typeof alice, id: string) => {
      while (!controller.signal.aborted) {
        const { body } = await account.get(`${prefix}/chat`).expect(200);
        const turn = chatHistorySchema.parse(body).turns.find((turn) => turn.id === id);
        if (turn && turn.status !== 'pending') {
          expect(turn.status).toBe('completed');
          return;
        }
        await sleep(100);
      }
      throw new Error('Chat turn did not finish');
    };

    const message = { id: randomUUID(), message: 'Stream isolation check' };
    await bob.post(`${prefix}/chat`).set(marker, '1').send(message).expect(202);
    await waitForReply(bob, message.id);

    await alice
      .post(`${prefix}/tasks`)
      .set(marker, '1')
      .send({ id: randomUUID(), title: 'Stream test', description: '', dueOn: null, agentId: null })
      .expect(201);
    await readUntil('tasks');
    expect(events).not.toContain('event: chat\n');

    const ownMessage = { id: randomUUID(), message: 'Own chat update' };
    await alice.post(`${prefix}/chat`).set(marker, '1').send(ownMessage).expect(202);
    await readUntil('chat');
    await waitForReply(alice, ownMessage.id);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}, 12_000);

it('allows verified invitees to join a workspace while keeping their identity and private tasks', async () => {
  const [owner, invitee, outsider] = Array.from({ length: 3 }, () => request.agent(app.getHttpServer()));
  if (!owner || !invitee || !outsider) throw new Error('Missing test clients');
  const emails = ['store-owner@geniebox.test', 'store-member@geniebox.test', 'store-outsider@geniebox.test'];
  for (const [index, client] of [owner, invitee, outsider].entries()) {
    const email = emails[index] ?? '';
    await client
      .post(`${prefix}/auth/register`)
      .set(marker, '1')
      .send({ email, password, name: email, locale: 'en' })
      .expect(200);
    const code = await codeFromMail(email, 'Verify your Geniebox email address');
    await client
      .post(`${prefix}/auth/email/verification/confirm`)
      .set(marker, '1')
      .send({ code })
      .expect(204);
  }
  const accountsUrl = `${prefix}/accounts`;
  const store = z.uuid().parse((await owner.get(accountsUrl).expect(200)).body.activeId);
  const home = z.uuid().parse((await invitee.get(accountsUrl).expect(200)).body.activeId);
  expect(home).not.toBe(store);

  await owner.patch(`${accountsUrl}/current`).set(marker, '1').send({ name: 'Checkout Lab' }).expect(204);
  await invitee.post(`${accountsUrl}/${store}/select`).set(marker, '1').expect(404);
  await outsider.get(`${prefix}/tasks`).set('X-Geniebox-Workspace', store).expect(403);

  await owner
    .post(`${accountsUrl}/current/invitations`)
    .set(marker, '1')
    .send({ email: emails[1] })
    .expect(204);
  const code = await codeFromMail(
    emails[1] ?? '',
    'Geniebox workspace invitation',
    /(?<![\w-])[\w-]{43}(?![\w-])/,
  );
  const ownerDb = createDb(ownerUrl);
  try {
    const pending = await ownerDb
      .selectFrom('outbox_events')
      .select('payload')
      .where('tenant_id', '=', store)
      .where('type', '=', 'mail.requested')
      .executeTakeFirstOrThrow();
    expect(pending.payload).toMatchObject({ ciphertext: expect.any(String) });
    expect(JSON.stringify(pending.payload)).not.toContain(code);
    expect(JSON.stringify(pending.payload)).not.toContain(emails[1]);
  } finally {
    await ownerDb.destroy();
  }
  await outsider.post(`${accountsUrl}/join`).set(marker, '1').send({ code }).expect(404);
  await invitee.post(`${accountsUrl}/join`).set(marker, '1').send({ code }).expect(204);
  await invitee.post(`${accountsUrl}/join`).set(marker, '1').send({ code }).expect(404);
  await invitee
    .get(accountsUrl)
    .expect(200)
    .expect(({ body }) => {
      expect(body).toMatchObject({ activeId: store });
      expect(body.workspaces).toEqual(
        expect.arrayContaining([{ id: store, role: 'member', name: 'Checkout Lab' }]),
      );
    });
  await invitee
    .get(`${prefix}/me`)
    .expect(200)
    .expect(({ body }) => {
      expect(body).toMatchObject({ email: emails[1], tenantId: store, emailVerified: true });
    });
  await invitee
    .get(`${prefix}/me/sessions`)
    .expect(200)
    .expect(({ body }) => expect(body).toHaveLength(1));
  await invitee
    .patch(`${accountsUrl}/current`)
    .set(marker, '1')
    .send({ name: 'Unauthorized rename' })
    .expect(403);
  await owner
    .get(`${accountsUrl}/current/members`)
    .expect(200)
    .expect(({ body }) => expect(body).toHaveLength(2));

  const task = {
    id: randomUUID(),
    title: 'Private member task',
    dueOn: null,
    agentId: null,
    description: '',
  };
  await invitee.post(`${prefix}/tasks`).set(marker, '1').send(task).expect(201);
  await owner.get(`${prefix}/tasks/${task.id}`).expect(404);
  await invitee.get(`${prefix}/tasks/${task.id}`).set('X-Geniebox-Workspace', home).expect(404);
  await invitee.post(`${accountsUrl}/${home}/select`).set(marker, '1').expect(204);
  await invitee.get(`${prefix}/tasks/${task.id}`).expect(404);
  await invitee.get(`${prefix}/tasks/${task.id}`).set('X-Geniebox-Workspace', store).expect(200);
}, 20_000);

it('keeps workspace connections isolated and retains the previous source when verification fails', async () => {
  const owner = request.agent(app.getHttpServer());
  const other = request.agent(app.getHttpServer());
  for (const [index, client] of [owner, other].entries()) {
    await client
      .post(`${prefix}/auth/register`)
      .set(marker, '1')
      .send({
        email: `connection-${index}@geniebox.test`,
        password,
        name: 'Connection Test',
      })
      .expect(200);
  }
  const path = `${prefix}/connections`;
  const metrica = `${path}/yandex-metrica`;
  await owner.put(metrica).set(marker, '1').send({ mode: 'demo' }).expect(204);
  await owner
    .get(path)
    .expect(200)
    .expect(({ body }) => expect(body.metrica.mode).toBe('demo'));
  await other.get(path).expect(200, { liveAvailable: true, metrica: null });

  const provider = jest.spyOn(app.get(MetricaProvider), 'totals');
  const input = { mode: 'live', counterId: '44147844', token: 'integration-token-only' };
  try {
    provider.mockRejectedValueOnce(new Error('Provider unavailable'));
    await owner.put(metrica).set(marker, '1').send(input).expect(500);
    await owner
      .get(path)
      .expect(200)
      .expect(({ body }) => expect(body.metrica.mode).toBe('demo'));
    provider.mockResolvedValueOnce({
      visits: 50,
      users: 40,
      pageviews: 150,
      sampled: false,
      url: 'https://metrika.yandex.ru/dashboard?id=44147844',
    });
    await owner.put(metrica).set(marker, '1').send(input).expect(204);
    await owner
      .get(path)
      .expect(200)
      .expect(({ body }) => {
        expect(body.metrica).toMatchObject({ mode: 'live', counterId: input.counterId });
        expect(JSON.stringify(body)).not.toContain(input.token);
      });
    await other.delete(metrica).set(marker, '1').expect(204);
    await owner
      .get(path)
      .expect(200)
      .expect(({ body }) => expect(body.metrica.mode).toBe('live'));
    await owner.delete(metrica).set(marker, '1').expect(204);
    await owner.get(path).expect(200, { liveAvailable: true, metrica: null });
  } finally {
    provider.mockRestore();
  }
}, 20_000);

it('compares equal periods with a success threshold and preserves workspace report history', async () => {
  const owner = request.agent(app.getHttpServer());
  const outsider = request.agent(app.getHttpServer());
  for (const [index, client] of [owner, outsider].entries()) {
    await client
      .post(`${prefix}/auth/register`)
      .set(marker, '1')
      .send({
        email: `report-${index}@geniebox.test`,
        password,
        name: 'Report Test',
      })
      .expect(200);
  }
  const reports = `${prefix}/reports`;
  const source = `${prefix}/connections/yandex-metrica`;
  const metric = `${prefix}/metrics`;
  const input = {
    title: 'Checkout follow-up',
    metric: 'visits',
    baseline: { from: '2026-07-01', to: '2026-07-03' },
    comparison: { from: '2026-07-08', to: '2026-07-10' },
    criterion: { direction: 'atLeast', target: 2 },
  };
  await owner.post(reports).set(marker, '1').send(input).expect(409);
  await owner.put(source).set(marker, '1').send({ mode: 'demo' }).expect(204);
  await owner.put(metric).set(marker, '1').send({ key: 'visits', label: 'Shop visits' }).expect(204);
  await owner
    .post(reports)
    .set(marker, '1')
    .send({ ...input, comparison: input.baseline })
    .expect(400);
  const created = await owner.post(reports).set(marker, '1').send(input).expect(201);
  const report = z
    .object({
      metric: z.string(),
      label: z.string(),
      source: z.string(),
      before: z.number(),
      after: z.number(),
      change: z.number(),
      criterionMet: z.boolean(),
    })
    .parse(created.body);
  expect(report).toMatchObject({ label: 'Shop visits', source: 'demo', metric: 'visits' });
  expect(report.change).toBeCloseTo(((report.after - report.before) / report.before) * 100);
  expect(report.criterionMet).toBe(report.change >= 2);
  await outsider.get(reports).expect(200, { reports: [], next: null });

  await owner.put(metric).set(marker, '1').send({ key: 'visits', label: 'New visits label' }).expect(204);
  await owner.delete(source).set(marker, '1').expect(204);
  await owner.get(reports).expect(200, { reports: [{ ...created.body, decision: null }], next: null });

  const path = `${reports}/${created.body.id}/decision`;
  const decision = { outcome: 'followUp', rationale: 'Review the checkout with the product team' };
  await outsider.post(path).set(marker, '1').send(decision).expect(404);
  const response = await Promise.all(
    [1, 2].map(() => owner.post(path).set(marker, '1').send(decision).expect(200)),
  );
  expect(response[0]?.body).toEqual(response[1]?.body);
  const taskId = z.uuid().parse(response[0]?.body.taskId);
  await owner.get(`${prefix}/tasks/counts`).expect(200, { active: 1, done: 0 });
  await owner
    .get(`${prefix}/tasks/${taskId}`)
    .expect(200)
    .expect(({ body }) => {
      expect(body).toMatchObject({ id: taskId, title: input.title, description: decision.rationale });
    });
  await owner.post(path).set(marker, '1').send({ outcome: 'close', rationale: '' }).expect(409);
  await owner
    .get(reports)
    .expect(200, { reports: [{ ...created.body, decision: response[0]?.body }], next: null });
  await owner.put(source).set(marker, '1').send({ mode: 'demo' }).expect(204);
  const retained = await owner
    .post(reports)
    .set(marker, '1')
    .send({ ...input, title: 'Retain current design' })
    .expect(201);
  await owner
    .post(`${reports}/${retained.body.id}/decision`)
    .set(marker, '1')
    .send({ outcome: 'close', rationale: 'No further changes are needed' })
    .expect(200)
    .expect(({ body }) => expect(body.taskId).toBeNull());
  await owner.get(`${prefix}/tasks/counts`).expect(200, { active: 1, done: 0 });
}, 20_000);

it('runs only due, enabled schedules and creates at most one task per automatic occurrence', async () => {
  const owner = request.agent(app.getHttpServer());
  const other = request.agent(app.getHttpServer());
  for (const [index, client] of [owner, other].entries()) {
    const email = `routine-${index}@geniebox.test`;
    await client
      .post(`${prefix}/auth/email-code`)
      .set(marker, '1')
      .set('Accept-Language', 'en')
      .send({ email })
      .expect(204);
    const code = await codeFromMail(email, 'Geniebox sign-in code');
    await client.post(`${prefix}/auth/email-code/verify`).set(marker, '1').send({ email, code }).expect(200);
  }
  const tenantId = z.uuid().parse((await owner.get(`${prefix}/me`).expect(200)).body.tenantId);
  const routines = `${prefix}/routines`;
  const input = {
    id: randomUUID(),
    title: 'Review store indicators',
    description: 'Check the weekly trend',
    cadence: 'weekly',
  };
  await owner.post(routines).set(marker, '1').send(input).expect(201);
  await owner.post(routines).set(marker, '1').send(input).expect(201);
  await other.get(routines).expect(200, []);
  await other.post(`${routines}/${input.id}/run`).set(marker, '1').send({ id: randomUUID() }).expect(404);

  const taskId = randomUUID();
  for (let retry = 0; retry < 2; retry++) {
    await owner
      .post(`${routines}/${input.id}/run`)
      .set(marker, '1')
      .send({ id: taskId })
      .expect(201, { taskId });
  }

  const makeDue = () =>
    app.get<ClsService<RequestContext>>(ClsService).runWith({ tenantId }, () =>
      app.get(TenantDb).transaction((tx) =>
        tx
          .updateTable('task_routines')
          .set({ next_run_at: new Date(Date.now() - 10_000) })
          .where('id', '=', input.id)
          .execute(),
      ),
    );
  const scheduler = app.get(RoutinesService);
  await owner.patch(`${routines}/${input.id}`).set(marker, '1').send({ enabled: false }).expect(200);
  await makeDue();
  await scheduler.tick();
  await owner.get(`${prefix}/tasks/counts`).expect(200, { active: 1, done: 0 });

  await owner.patch(`${routines}/${input.id}`).set(marker, '1').send({ enabled: true }).expect(200);
  await makeDue();
  await Promise.all([scheduler.tick(), scheduler.tick()]);
  await owner.get(`${prefix}/tasks/counts`).expect(200, { active: 2, done: 0 });
  await owner
    .get(routines)
    .expect(200)
    .expect(({ body }) => {
      expect(body).toHaveLength(1);
      expect(Date.parse(body[0].nextRunAt)).toBeGreaterThan(Date.now());
    });
}, 20_000);

it('provisions isolated agents once, tracks instruction versions and gives the metrics agent saved reports', async () => {
  const owner = request.agent(app.getHttpServer());
  const other = request.agent(app.getHttpServer());
  for (const [index, client] of [owner, other].entries()) {
    const email = `catalog-${index}@geniebox.test`;
    await client
      .post(`${prefix}/auth/email-code`)
      .set(marker, '1')
      .set('Accept-Language', 'en')
      .send({ email })
      .expect(204);
    const code = await codeFromMail(email, 'Geniebox sign-in code');
    await client.post(`${prefix}/auth/email-code/verify`).set(marker, '1').send({ email, code }).expect(200);
  }
  const path = `${prefix}/agents`;
  const [first, concurrent] = await Promise.all([owner.get(path).expect(200), owner.get(path).expect(200)]);
  expect(first.body).toEqual(concurrent.body);
  expect(first.body).toHaveLength(3);
  const agent = z
    .object({
      id: z.uuid(),
      instructions: z.string(),
      catalogKey: z.string(),
      enabled: z.boolean(),
      revision: z.number(),
    })
    .array()
    .parse(first.body)
    .find(({ catalogKey }) => catalogKey === 'metrics');
  if (!agent) throw new Error('Missing metrics agent');
  expect(agent).toMatchObject({ enabled: false, revision: 1 });
  const item = `${path}/${agent.id}`;
  await other.get(`${item}/versions`).expect(404);
  await owner
    .patch(item)
    .set(marker, '1')
    .send({ instructions: 'Revised measurement instructions', expectedRevision: 1 })
    .expect(200)
    .expect(({ body }) => {
      expect(body).toMatchObject({ revision: 2 });
    });
  await owner
    .patch(item)
    .set(marker, '1')
    .send({ instructions: 'Stale editing', expectedRevision: 1 })
    .expect(409);
  await owner
    .post(`${item}/restore`)
    .set(marker, '1')
    .send({ revision: 1, expectedRevision: 2 })
    .expect(201)
    .expect(({ body }) => {
      expect(body).toMatchObject({ revision: 3, instructions: agent.instructions });
    });
  await owner
    .patch(item)
    .set(marker, '1')
    .send({ enabled: true })
    .expect(200)
    .expect(({ body }) => {
      expect(body).toMatchObject({ revision: 3, enabled: true });
    });
  await owner
    .get(`${item}/versions`)
    .expect(200)
    .expect(({ body }) => {
      expect(body.items.map(({ revision }: { revision: number }) => revision)).toEqual([3, 2, 1]);
    });

  for (const [client, title] of [
    [owner, 'Saved catalog evidence'],
    [other, 'Foreign catalog evidence'],
  ] as const) {
    await client
      .put(`${prefix}/connections/yandex-metrica`)
      .set(marker, '1')
      .send({ mode: 'demo' })
      .expect(204);
    await client
      .post(`${prefix}/reports`)
      .set(marker, '1')
      .send({
        title,
        metric: 'visits',
        baseline: { from: '2026-07-01', to: '2026-07-03' },
        comparison: { from: '2026-07-08', to: '2026-07-10' },
      })
      .expect(201);
  }

  const taskId = randomUUID();
  await owner
    .post(`${prefix}/tasks`)
    .set(marker, '1')
    .send({
      id: taskId,
      title: 'Assess saved catalog report',
      description: '',
      agentId: agent.id,
      dueOn: null,
    })
    .expect(201);
  let done = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const { body } = await owner.get(`${prefix}/tasks/${taskId}`).expect(200);
    if (body.status !== 'planned' && body.status !== 'running') {
      expect(body.status).toBe('done');
      done = true;
      break;
    }
    await sleep(100);
  }
  expect(done).toBe(true);
  const received = JSON.stringify(modelRequests.at(-1));
  expect(received).toContain('Saved catalog evidence');
  expect(received).toContain('"demo"'.replaceAll('"', '\\"'));
  expect(received).not.toContain('Foreign catalog evidence');
}, 20_000);

it('delivers pending chat and mail after the relay resumes without polling the chat API', async () => {
  const actor = request.agent(app.getHttpServer());
  const email = 'worker-restart@geniebox.test';
  await actor
    .post(`${prefix}/auth/email-code`)
    .set(marker, '1')
    .set('Accept-Language', 'en')
    .send({ email })
    .expect(204);
  const code = await codeFromMail(email, 'Geniebox sign-in code');
  await actor
    .post(`${prefix}/auth/email-code/verify`)
    .set(marker, '1')
    .set('Accept-Language', 'en')
    .send({ email, code })
    .expect(200);
  const tenantId = z.uuid().parse((await actor.get(`${prefix}/me`).expect(200)).body.tenantId);

  const db = createDb(ownerUrl);
  const relay = worker.get(OutboxRelay);
  const turn = { id: randomUUID(), message: 'Deliver this turn when the relay resumes' };
  await relay.onModuleDestroy();

  try {
    const invitee = 'outbox-invitee@geniebox.test';
    await actor
      .post(`${prefix}/accounts/current/invitations`)
      .set(marker, '1')
      .send({ email: invitee })
      .expect(204);
    const mailEvent = await db
      .selectFrom('outbox_events')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('type', '=', 'mail.requested')
      .executeTakeFirstOrThrow();
    expect(mailEvent.published_at).toBeNull();
    expect(JSON.stringify(mailEvent.payload)).not.toContain(invitee);

    await actor.post(`${prefix}/chat`).set(marker, '1').send(turn).expect(202);
    const event = await db
      .selectFrom('outbox_events')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('type', '=', 'chat.requested')
      .executeTakeFirstOrThrow();
    expect(event.published_at).toBeNull();
    expect(event.payload).toMatchObject({ turnId: turn.id });
    const journal = await db
      .selectFrom('action_journal')
      .selectAll()
      .where('target_id', '=', turn.id)
      .executeTakeFirstOrThrow();
    expect(journal).toMatchObject({ action: 'chat.turn_submitted', trace_id: event.trace_id });
    expect(JSON.stringify(journal)).not.toContain(turn.message);
    await expect(
      db.updateTable('action_journal').set({ result: 'tampered' }).where('id', '=', journal.id).execute(),
    ).rejects.toMatchObject({ code: '42501' });
    expect(JSON.stringify(modelRequests)).not.toContain(turn.message);

    relay.onModuleInit();
    await codeFromMail(invitee, 'Geniebox workspace invitation', /(?<![\w-])[\w-]{43}(?![\w-])/);
    for (let attempt = 0; attempt < 80; attempt++) {
      const row = await db
        .selectFrom('chat_turns')
        .select('status')
        .where('id', '=', turn.id)
        .executeTakeFirstOrThrow();
      if (row.status === 'completed') break;
      await sleep(100);
    }
    const status = await db
      .selectFrom('chat_turns')
      .select('status')
      .where('id', '=', turn.id)
      .executeTakeFirstOrThrow();
    expect(status.status).toBe('completed');
    expect(JSON.stringify(modelRequests)).toContain(turn.message);
    const delivered = await db
      .selectFrom('outbox_events')
      .select('published_at')
      .where('id', '=', event.id)
      .executeTakeFirstOrThrow();
    expect(delivered.published_at).toBeInstanceOf(Date);
  } finally {
    await db.destroy();
  }
}, 20_000);
