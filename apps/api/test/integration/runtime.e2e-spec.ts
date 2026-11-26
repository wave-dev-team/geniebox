import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { z } from 'zod';

import type { TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../src/common/context/app-cls-store.js';
import { MailModule } from '../../src/modules/mail/mail.module.js';
import {
  type BrokerTool,
  defineTool,
  type ToolContext,
} from '../../src/modules/runtime/broker/broker.types.js';
import { ToolExecutor } from '../../src/modules/runtime/broker/tool-executor.js';
import { ToolRegistry } from '../../src/modules/runtime/broker/tool-registry.js';
import { RuntimeContextLoader } from '../../src/modules/runtime/runtime-context.js';
import { WorkerModule } from '../../src/worker.module.js';
import { asAccount, connectAs, eventually, flushRedis, infra, uniqueEmail } from '../support/helpers.js';
import { ApiHarness, type TokenPair } from '../support/http-app.js';

interface Message {
  id: string;
  role: string;
  agentId: string | null;
  text: string;
  status: string;
  cards: Array<{ type: string; id: string }>;
}
interface Task {
  id: string;
  agentId: string;
  status: string;
  result: string | null;
  steps: Array<{ title: string; status: string }>;
  decisionId: string | null;
  error: { code: string; what: string } | null;
  origin: string;
}
interface Decision {
  id: string;
  status: string;
  selectedTerm: string | null;
  terms: { proposed: string; options: Array<{ value: string }> } | null;
  taskId: string | null;
}

/** Superuser on the test database: reads across RLS for assertions. */
function superDb() {
  const url = new URL(infra().adminUrl);
  url.pathname = `/${infra().database}`;
  return connectAs(url.toString());
}

describe('agent runtime (HTTP, fake model)', () => {
  let api: ApiHarness;
  let worker: TestingModule;
  let owner: TokenPair;
  let accountId: string;
  let projectId: string;
  let intelId: string;
  let broadcasts = 0;

  const base = () => `/v1/accounts/${accountId}/projects/${projectId}`;

  async function task(id: string): Promise<Task> {
    return (await api.get(`${base()}/tasks/${id}`, owner.accessToken).expect(200)).body as Task;
  }

  async function messages(conversationId: string): Promise<Message[]> {
    return (
      await api.get(`${base()}/conversations/${conversationId}/messages`, owner.accessToken).expect(200)
    ).body as Message[];
  }

  async function giveTask(title: string, agentId = intelId): Promise<Task> {
    return (await api.post(`${base()}/tasks`, { agentId, title }, owner.accessToken).expect(201))
      .body as Task;
  }

  beforeAll(async () => {
    await flushRedis();
    api = await ApiHarness.create();
    worker = await api.worker([WorkerModule, MailModule]);

    // A mutating catalog tool for the broker tests (real external tools come with their tests).
    worker.get(ToolRegistry).register(
      defineTool({
        id: 'bot.broadcast',
        title: 'Рассылка в бот',
        description: 'test broadcast',
        kind: 'catalog',
        audience: ['agent'],
        risk: 'high',
        mutating: true,
        providers: ['telegram_bot'],
        schema: z.object({ recipients: z.number().int().min(1), text: z.string().min(1) }).strict(),
        askFor: (args) => (args.recipients > 500 ? 'mailing_over_500' : null),
        limit: (args) => (args.recipients > 10_000 ? 'RECIPIENTS_LIMIT' : null),
        execute: () => {
          broadcasts++;
          return Promise.resolve({ sent: true });
        },
      }),
    );

    owner = await api.signInWithCode(uniqueEmail('rt-owner'));
    accountId = (
      (await api.post('/v1/accounts', { name: 'Runtime' }, owner.accessToken).expect(201)).body as {
        id: string;
      }
    ).id;
    projectId = (
      (
        await api
          .post(`/v1/accounts/${accountId}/projects`, { name: 'Сервис' }, owner.accessToken)
          .expect(201)
      ).body as { id: string }
    ).id;
    intelId = (
      (
        await api
          .post(`${base()}/agents`, { templateKey: 'intel', connections: [] }, owner.accessToken)
          .expect(201)
      ).body as { id: string }
    ).id;
  });

  afterAll(async () => {
    await worker.close();
    await api.close();
  });

  it('answers through the manager, who delegates; the agent reports back', async () => {
    // The manager comes from the project.created event: wait for it.
    const conversation = await eventually(
      async () =>
        (await api.post(`${base()}/conversations`, {}, owner.accessToken).expect(201)).body as {
          id: string;
          agentId: string;
        },
    );
    const posted = (
      await api
        .post(
          `${base()}/conversations/${conversation.id}/messages`,
          { text: 'Почему растёт уход клиентов?', mode: 'approve_all' },
          owner.accessToken,
        )
        .expect(201)
    ).body as { message: Message; reply: Message };
    expect(posted.reply).toMatchObject({ status: 'streaming', agentId: conversation.agentId });

    // One answer at a time.
    await api
      .post(`${base()}/conversations/${conversation.id}/messages`, { text: 'ещё' }, owner.accessToken)
      .expect(409);

    const reply = await eventually(async () => {
      const found = (await messages(conversation.id)).find((m) => m.id === posted.reply.id);
      expect(found?.status).toBe('done');
      return found!;
    });
    expect(reply.text).toMatch(/Поручил/);
    const card = reply.cards.find((c) => c.type === 'task');
    expect(card).toBeDefined();

    const done = await eventually(async () => {
      const current = await task(card!.id);
      expect(current.status).toBe('done');
      return current;
    });
    expect(done).toMatchObject({ agentId: intelId, origin: 'manager' });
    expect(done.steps.length).toBeGreaterThan(0);
    expect(done.steps.every((step) => step.status === 'done')).toBe(true);

    // The agent's result appears in the same conversation with the task card.
    await eventually(async () => {
      const report = (await messages(conversation.id)).find(
        (m) => m.agentId === intelId && m.cards.some((c) => c.id === card!.id),
      );
      expect(report?.text).toMatch(/Готово/);
    });

    const db = superDb();
    try {
      const calls = await db
        .selectFrom('llm_calls')
        .select(['role', 'prompt_version', 'result', 'cost_rub'])
        .where('project_id', '=', projectId)
        .execute();
      expect(calls.map((c) => c.role)).toEqual(expect.arrayContaining(['manager.turn', 'agent.task']));
      expect(calls.every((c) => c.result === 'ok')).toBe(true);
    } finally {
      await db.destroy();
    }
  });

  it('waits for a decision; «да» with changed terms finishes the task', async () => {
    const given = await giveTask('Запустить акцию со скидкой для ушедших');
    const waiting = await eventually(async () => {
      const current = await task(given.id);
      expect(current.status).toBe('waiting');
      return current;
    });
    expect(waiting.decisionId).not.toBeNull();
    expect(waiting.steps.at(-1)).toMatchObject({ title: 'Ждёт вашего решения', status: 'current' });

    const counters = (await api.get(`${base()}/counters`, owner.accessToken).expect(200)).body as {
      pendingDecisions: number;
    };
    expect(counters.pendingDecisions).toBeGreaterThanOrEqual(1);

    await api
      .post(`${base()}/decisions/${waiting.decisionId}/accept`, { term: '15' }, owner.accessToken)
      .expect(400);
    const accepted = (
      await api
        .post(`${base()}/decisions/${waiting.decisionId}/accept`, { term: '40' }, owner.accessToken)
        .expect(200)
    ).body as Decision;
    expect(accepted).toMatchObject({ status: 'modified', selectedTerm: '40' });
    // A second «да» is idempotent; «нет» after «да» is a conflict.
    await api.post(`${base()}/decisions/${waiting.decisionId}/accept`, {}, owner.accessToken).expect(200);
    await api.post(`${base()}/decisions/${waiting.decisionId}/reject`, {}, owner.accessToken).expect(409);

    await eventually(async () => {
      const current = await task(given.id);
      expect(current.status).toBe('done');
      expect(current.result).toMatch(/Принято/);
    });
  });

  it('«нет» closes the task and keeps the agent from proposing the same for a while', async () => {
    const first = await giveTask('Скидка для новых клиентов');
    const waiting = await eventually(async () => {
      const current = await task(first.id);
      expect(current.status).toBe('waiting');
      return current;
    });
    await api
      .post(`${base()}/decisions/${waiting.decisionId}/reject`, { reason: 'дорого' }, owner.accessToken)
      .expect(200);
    await eventually(async () => expect((await task(first.id)).status).toBe('cancelled'));

    const second = await giveTask('Скидка для тех, кто вернулся');
    await eventually(async () => expect((await task(second.id)).status).toBe('done'));
    const db = superDb();
    try {
      const refused = await db
        .selectFrom('tool_calls')
        .select(['tool_id', 'status', 'error_code'])
        .where('task_id', '=', second.id)
        .where('tool_id', '=', 'propose_decision')
        .execute();
      expect(refused).toEqual([
        { tool_id: 'propose_decision', status: 'failed', error_code: 'DECISION_COOLDOWN' },
      ]);
    } finally {
      await db.destroy();
    }
  });

  it('cancels, retries and lists tasks', async () => {
    const given = await giveTask('Посмотреть конкурентов');
    await eventually(async () => expect((await task(given.id)).status).toBe('done'));
    await api.post(`${base()}/tasks/${given.id}/cancel`, {}, owner.accessToken).expect(409);

    const done = (await api.get(`${base()}/tasks?tab=done`, owner.accessToken).expect(200)).body as Task[];
    expect(done.map((t) => t.id)).toContain(given.id);
    const counts = (await api.get(`${base()}/task-counts`, owner.accessToken).expect(200)).body as {
      done: number;
    };
    expect(counts.done).toBeGreaterThanOrEqual(1);
  });

  it('stops on an exhausted AI budget before calling the model', async () => {
    await api.patch(`${base()}/rules`, { aiBudgetMonthly: 0 }, owner.accessToken).expect(200);
    const given = await giveTask('Посмотреть цены конкурентов');
    const failed = await eventually(async () => {
      const current = await task(given.id);
      expect(current.status).toBe('failed');
      return current;
    });
    expect(failed.error).toMatchObject({ code: 'BUDGET' });
    // «Повторить» after raising the budget.
    await api.patch(`${base()}/rules`, { aiBudgetMonthly: 20000 }, owner.accessToken).expect(200);
    await api.post(`${base()}/tasks/${given.id}/run`, {}, owner.accessToken).expect(200);
    await eventually(async () => expect((await task(given.id)).status).toBe('done'));
  });

  describe('tool executor', () => {
    let executor: ToolExecutor;
    let cls: ClsService<AppClsStore>;
    let context: ToolContext;
    let offered: string[];

    beforeAll(async () => {
      executor = worker.get(ToolExecutor);
      cls = worker.get(ClsService);
      const bot = (
        (
          await api
            .post(
              `${base()}/connections`,
              {
                providerKey: 'telegram_bot',
                accessLevel: 'read_write',
                fields: { token: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
              },
              owner.accessToken,
            )
            .expect(201)
        ).body as { connection: { id: string } }
      ).connection.id;
      const custom = (
        await api
          .post(
            `${base()}/agents`,
            {
              custom: { name: 'Рассыльщик', icon: { kind: 'glyph', value: 'mail' } },
              connections: [{ connectionId: bot, accessLevel: 'read_write' }],
              trustLevel: 'autonomous',
            },
            owner.accessToken,
          )
          .expect(201)
      ).body as { id: string };
      const loaded = await asAccount(cls, accountId, () => worker.get(RuntimeContextLoader).agent(custom.id));
      context = {
        accountId,
        projectId,
        agent: loaded!.runtime,
        taskId: null,
        conversationId: null,
        replyMessageId: null,
        userId: owner.userId,
        mode: null,
      };
      offered = worker
        .get(ToolRegistry)
        .available(loaded!.runtime, 'agent')
        .map((tool: BrokerTool) => tool.id);
      expect(offered).toContain('bot.broadcast');

      // Accounts start with agent actions off (safe default): nothing mutating runs.
      expect(
        await asAccount(cls, accountId, () =>
          executor.execute(context, 'bot.broadcast', { recipients: 1, text: 'x' }, offered),
        ),
      ).toMatchObject({ status: 'blocked', errorCode: 'KILL_SWITCH_ACCOUNT' });
      const admin = superDb();
      try {
        await admin
          .updateTable('accounts')
          .set({ agent_actions_enabled: true })
          .where('id', '=', accountId)
          .execute();
      } finally {
        await admin.destroy();
      }
    });

    const run = (args: unknown, overrides: Partial<ToolContext> = {}, id = 'bot.broadcast', list = offered) =>
      asAccount(cls, accountId, () =>
        executor.execute({ ...context, ...overrides }, id, args as Record<string, unknown>, list),
      );

    it('refuses invalid, extra and unknown arguments', async () => {
      expect(await run({ recipients: 'много', text: 'x' })).toMatchObject({
        status: 'rejected',
        errorCode: 'INVALID_ARGUMENTS',
      });
      expect(await run({ recipients: 10, text: 'x', sql: 'drop' })).toMatchObject({
        errorCode: 'INVALID_ARGUMENTS',
      });
      expect(await run('{not json')).toMatchObject({ errorCode: 'INVALID_JSON' });
    });

    it('refuses tools the role was not offered, whatever the model asks', async () => {
      expect(await run({}, {}, 'policy.update')).toMatchObject({
        status: 'rejected',
        errorCode: 'UNKNOWN_TOOL',
      });
      expect(await run({ agentId: intelId, title: 'x', why: 'y' }, {}, 'assign_task')).toMatchObject({
        errorCode: 'UNKNOWN_TOOL',
      });
      expect(await run({ recipients: 1, text: 'x' }, {}, 'bot.broadcast', ['finish_task'])).toMatchObject({
        errorCode: 'UNKNOWN_TOOL',
      });
    });

    it('enforces hard limits, request mode and «always ask»', async () => {
      expect(await run({ recipients: 20_000, text: 'x' })).toMatchObject({
        status: 'rejected',
        errorCode: 'RECIPIENTS_LIMIT',
      });
      expect(await run({ recipients: 10, text: 'x' }, { mode: 'recommend_only' })).toMatchObject({
        status: 'denied',
        errorCode: 'RECOMMEND_ONLY',
      });
      // Project rule «mailing_over_500» forces a decision even for an autonomous agent.
      const approval = await run({ recipients: 900, text: 'Новые серверы' });
      expect(approval).toMatchObject({ status: 'approval', terminal: true });
      const accepted = (
        await api.post(`${base()}/decisions/${approval.decisionId}/accept`, {}, owner.accessToken).expect(200)
      ).body as Decision;
      expect(accepted.status).toBe('accepted');
      // The approved action runs once, through the broker, on behalf of the agent.
      await eventually(() => {
        expect(broadcasts).toBe(1);
        return Promise.resolve();
      });
    });

    it('is idempotent per work and arguments', async () => {
      const before = broadcasts;
      const first = await run(
        { recipients: 10, text: 'Привет' },
        { taskId: null, replyMessageId: crypto.randomUUID() },
      );
      expect(first.status).toBe('executed');
      const scope = { replyMessageId: '11111111-1111-4111-8111-111111111111' };
      await run({ recipients: 11, text: 'Привет' }, scope);
      await run({ recipients: 11, text: 'Привет' }, scope);
      expect(broadcasts).toBe(before + 2);
    });

    it('stops mutating calls when a kill switch is off', async () => {
      await api.post(`${base()}/pause`, {}, owner.accessToken).expect(200);
      expect(await run({ recipients: 5, text: 'x' })).toMatchObject({
        status: 'blocked',
        errorCode: 'KILL_SWITCH_PROJECT',
      });
      await api.post(`${base()}/resume`, {}, owner.accessToken).expect(200);

      const db = superDb();
      try {
        await db
          .updateTable('platform_flags')
          .set({ enabled: false })
          .where('key', '=', 'agent_actions_enabled')
          .execute();
        expect(await run({ recipients: 6, text: 'x' })).toMatchObject({
          errorCode: 'KILL_SWITCH_PLATFORM',
        });
      } finally {
        await db
          .updateTable('platform_flags')
          .set({ enabled: true })
          .where('key', '=', 'agent_actions_enabled')
          .execute();
        await db.destroy();
      }
    });

    it("cannot reach another tenant's agents", async () => {
      const outcome = await asAccount(cls, accountId, () =>
        executor.execute(
          { ...context, agent: { ...context.agent, kind: 'manager' } },
          'assign_task',
          { agentId: '22222222-2222-4222-8222-222222222222', title: 'x', why: 'y' },
          ['assign_task'],
        ),
      );
      expect(outcome).toMatchObject({ status: 'failed', errorCode: 'AGENT_NOT_IN_TEAM' });
    });
  });

  it('runs routines: «Итоги дня» after onboarding, run now, schedule', async () => {
    await api.post(`${base()}/onboarding/complete`, {}, owner.accessToken).expect((res) => {
      if (res.status >= 300) throw new Error(`onboarding complete: ${res.status}`);
    });
    const routine = await eventually(async () => {
      const list = (await api.get(`${base()}/routines`, owner.accessToken).expect(200)).body as Array<{
        id: string;
        kind: string | null;
        schedule: string;
        nextRunAt: string | null;
      }>;
      const digest = list.find((r) => r.kind === 'daily_digest');
      expect(digest).toBeDefined();
      return digest!;
    });
    expect(routine).toMatchObject({ schedule: 'daily_21' });
    expect(routine.nextRunAt).not.toBeNull();

    const run = (await api.post(`${base()}/routines/${routine.id}/run`, {}, owner.accessToken).expect(200))
      .body as Task;
    expect(run.origin).toBe('routine');
    await eventually(async () => {
      const current = (await api.get(`${base()}/routines/${routine.id}`, owner.accessToken).expect(200))
        .body as {
        lastRunSummary: string | null;
        recentRuns: Array<{ status: string }>;
      };
      expect(current.recentRuns[0]?.status).toBe('done');
      expect(current.lastRunSummary).not.toBeNull();
    });

    const changed = (
      await api
        .patch(`${base()}/routines/${routine.id}`, { schedule: 'hourly', enabled: false }, owner.accessToken)
        .expect(200)
    ).body as { enabled: boolean; nextRunAt: string | null };
    expect(changed).toMatchObject({ enabled: false, nextRunAt: null });
  });

  it('streams project events over SSE', async () => {
    await api.app.listen(0, '127.0.0.1');
    const port = (api.app.getHttpServer().address() as AddressInfo).port;
    const received: string[] = [];
    const request = http.get(
      {
        host: '127.0.0.1',
        port,
        path: `${base()}/stream`,
        headers: { authorization: `Bearer ${owner.accessToken}`, accept: 'text/event-stream' },
      },
      (response) => {
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => received.push(chunk));
      },
    );
    try {
      await eventually(() => {
        expect(received.join('')).toContain('event: ready');
        return Promise.resolve();
      });
      await giveTask('Посмотреть отзывы');
      await eventually(() => {
        expect(received.join('')).toContain('event: task.updated');
        return Promise.resolve();
      });
    } finally {
      request.destroy();
    }
  });
});
