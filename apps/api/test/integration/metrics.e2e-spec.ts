import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { jest } from '@jest/globals';

import type { TestingModule } from '@nestjs/testing';

import { ProviderHttp } from '../../src/modules/connections/providers/provider-http.js';
import { MailModule } from '../../src/modules/mail/mail.module.js';
import { MetricsMaintenance } from '../../src/modules/metrics/metrics-worker.js';
import { ToolRegistry } from '../../src/modules/runtime/broker/tool-registry.js';
import { ScheduledTasksSweeper } from '../../src/scheduling/scheduled-tasks.sweeper.js';
import { WorkerModule } from '../../src/worker.module.js';
import { connectAs, eventually, flushRedis, infra, uniqueEmail } from '../support/helpers.js';
import { ApiHarness, type TokenPair } from '../support/http-app.js';

interface Metric {
  id: string;
  key: string;
  title: string;
  unit: string;
  pinned: boolean;
  source: { kind: string } | null;
  connectionId: string | null;
  collectedAt: string | null;
  lastError: string | null;
}
interface Point {
  day: string;
  value: number;
}

/** Superuser on the test database: reads across RLS for assertions. */
function superDb() {
  const url = new URL(infra().adminUrl);
  url.pathname = `/${infra().database}`;
  return connectAs(url.toString());
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('metrics, results and checks (HTTP)', () => {
  let api: ApiHarness;
  let worker: TestingModule;
  let owner: TokenPair;
  let accountId: string;
  let projectId: string;
  let intelId: string;
  let server: http.Server;
  let apiUrl: string;
  let yookassaCalls = 0;
  let techSession: TokenPair;
  let viewerSession: TokenPair;
  let strangerSession: TokenPair;
  // Provider timestamps never change between two reads of the same payment.
  const startedAt = Date.now();

  const base = () => `/v1/accounts/${accountId}/projects/${projectId}`;

  async function metrics(): Promise<Metric[]> {
    return (await api.get(`${base()}/metrics`, owner.accessToken).expect(200)).body as Metric[];
  }

  async function series(metricId: string, days = 90): Promise<Point[]> {
    return (await api.get(`${base()}/metrics/${metricId}/series?days=${days}`, owner.accessToken).expect(200))
      .body as Point[];
  }

  async function connect(providerKey: string, fields: Record<string, string>): Promise<string> {
    const body = (
      await api.post(`${base()}/connections`, { providerKey, fields }, owner.accessToken).expect(201)
    ).body as { connection: { id: string } };
    return body.connection.id;
  }

  /** A member with a role, added directly (the mail worker of this file is not the API's). */
  async function addMember(session: TokenPair, role: 'admin' | 'tech' | 'viewer'): Promise<TokenPair> {
    const db = superDb();
    await db
      .insertInto('account_members')
      .values({ account_id: accountId, user_id: session.userId, role })
      .execute();
    await db.destroy();
    return session;
  }

  beforeAll(async () => {
    await flushRedis();
    // A customer's own API answering a daily series for /metrics/active.
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.headers.authorization !== 'Bearer own-metrics-token-0123456789') {
        res.writeHead(401).end();
        return;
      }
      if (url.pathname.endsWith('/metrics/active')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([{ day: url.searchParams.get('to'), value: 812 }]));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

    api = await ApiHarness.create();
    // Sign-in codes go through the mail queue: sign everyone in before the worker module
    // (with its own mail worker and transport) starts consuming it.
    owner = await api.signInWithCode(uniqueEmail('m-owner'));
    techSession = await api.signInWithCode(uniqueEmail('m-tech'));
    viewerSession = await api.signInWithCode(uniqueEmail('m-viewer'));
    strangerSession = await api.signInWithCode(uniqueEmail('m-stranger'));
    worker = await api.worker([WorkerModule, MailModule]);

    // YooKassa and Metrika answer from here: two pages of payments, a daily visits series.
    const providerHttp = worker.get(ProviderHttp);
    const realGet = providerHttp.get.bind(providerHttp);
    jest.spyOn(providerHttp, 'get').mockImplementation((url, request) => {
      const parsed = new URL(url);
      if (parsed.hostname === 'api.yookassa.ru') {
        yookassaCalls++;
        const at = (daysAgo: number) => new Date(startedAt - daysAgo * DAY_MS).toISOString();
        const page = parsed.searchParams.get('cursor')
          ? {
              items: [{ id: 'pay-3', captured_at: at(2), amount: { value: '500.00', currency: 'RUB' } }],
            }
          : {
              items: [
                { id: 'pay-1', captured_at: at(0), amount: { value: '1000.00', currency: 'RUB' } },
                {
                  id: 'pay-2',
                  captured_at: at(0),
                  amount: { value: '250.50', currency: 'RUB' },
                  payment_method: { type: 'bank_card' },
                },
              ],
              next_cursor: 'page-2',
            };
        return Promise.resolve({ status: 200, body: page });
      }
      if (parsed.hostname === 'api-metrika.yandex.net') {
        return Promise.resolve({
          status: 200,
          body: {
            data: [
              { dimensions: [{ name: parsed.searchParams.get('date2') }], metrics: [140] },
              { dimensions: [{ name: 'not-a-day' }], metrics: [1] },
            ],
          },
        });
      }
      return realGet(url, request);
    });

    accountId = (
      (await api.post('/v1/accounts', { name: 'Metrics' }, owner.accessToken).expect(201)).body as {
        id: string;
      }
    ).id;
    projectId = (
      (
        await api
          .post(`/v1/accounts/${accountId}/projects`, { name: 'Подписки' }, owner.accessToken)
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
    await worker?.close();
    await api?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('starts a project with default official metrics, the main one first and pinned', async () => {
    const list = await eventually(async () => {
      const rows = await metrics();
      if (rows.length < 3) throw new Error('defaults not created yet');
      return rows;
    });
    expect(list.map((m) => m.key)).toEqual(['revenue', 'payments', 'visits']);
    expect(list.filter((m) => m.pinned)).toHaveLength(3);
    expect(list.every((m) => m.source === null)).toBe(true);
  });

  it('binds YooKassa to revenue, keeps payments as events and collects idempotently', async () => {
    await connect('yookassa', { shop_id: '123456', secret_key: 'test_secret_key_value' });
    const revenue = await eventually(async () => {
      const row = (await metrics()).find((m) => m.key === 'revenue')!;
      if (!row.collectedAt) throw new Error(`not collected: ${row.lastError ?? 'pending'}`);
      return row;
    }, 20_000);
    expect(revenue.source).toEqual({ kind: 'yookassa.revenue', query: null, path: null });
    const points = await series(revenue.id);
    expect(points).toHaveLength(90);
    expect(points.reduce((sum, p) => sum + p.value, 0)).toBeCloseTo(1750.5);
    expect(points.at(-1)!.value).toBeCloseTo(1250.5);

    const db = superDb();
    const count = async () =>
      Number(
        (
          await db
            .selectFrom('events')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .where('project_id', '=', projectId)
            .executeTakeFirstOrThrow()
        ).n,
      );
    expect(await count()).toBe(3);
    const calls = yookassaCalls;
    await api.post(`${base()}/metrics/${revenue.id}/collect`, {}, owner.accessToken).expect(202);
    await eventually(() =>
      yookassaCalls >= calls + 2 ? Promise.resolve() : Promise.reject(new Error('not collected again')),
    );
    await eventually(async () => {
      expect(await count()).toBe(3);
      expect((await series(revenue.id)).reduce((sum, p) => sum + p.value, 0)).toBeCloseTo(1750.5);
    });
    await db.destroy();
  });

  it("collects from the owner's database read-only, Metrika and the owner's API", async () => {
    const dbUrl = new URL(infra().env.DATABASE_URL as string);
    const pg = await connect('postgres', {
      host: dbUrl.hostname,
      port: dbUrl.port,
      database: dbUrl.pathname.slice(1),
      username: dbUrl.username,
      password: decodeURIComponent(dbUrl.password),
      ssl: 'disable',
    });
    const active = (
      await api
        .post(
          `${base()}/metrics`,
          {
            title: 'Активные подписки',
            source: {
              kind: 'postgres.sql',
              query:
                "select d::date as day, 3 as value from generate_series($1::date, $2::date, interval '1 day') d",
            },
            connectionId: pg,
          },
          owner.accessToken,
        )
        .expect(201)
    ).body as Metric;
    expect(active).toMatchObject({ unit: 'count', pinned: false });
    await eventually(async () => {
      const points = await series(active.id);
      if (points.length !== 90) throw new Error(`points: ${points.length}`);
      expect(points.every((p) => p.value === 3)).toBe(true);
    }, 20_000);

    const writer = (
      await api
        .post(
          `${base()}/metrics`,
          {
            title: 'Пишет в базу',
            source: {
              kind: 'postgres.sql',
              query:
                'with t as (update projects set name = name returning 1) select now()::date as day, 1 as value from t',
            },
            connectionId: pg,
          },
          owner.accessToken,
        )
        .expect(201)
    ).body as Metric;
    await eventually(async () => {
      const row = (await metrics()).find((m) => m.id === writer.id)!;
      expect(row.lastError).toBe('READ_ONLY');
    }, 20_000);

    // A source that does not fit the connection is refused.
    await api
      .post(
        `${base()}/metrics`,
        { title: 'Не то', source: { kind: 'metrika.visits' }, connectionId: pg },
        owner.accessToken,
      )
      .expect(400)
      .expect((res) => expect(res.body).toMatchObject({ code: 'METRIC_SOURCE_INVALID' }));

    await connect('yandex_metrika', {
      counter_id: '123456',
      oauth_token: 'metrika-oauth-token-value',
    });
    await eventually(async () => {
      const visits = (await metrics()).find((m) => m.key === 'visits')!;
      if (!visits.collectedAt) throw new Error('visits not collected');
      expect((await series(visits.id)).map((p) => p.value)).toEqual([140]);
    }, 20_000);

    const own = await connect('http_api', { url: apiUrl, token: 'own-metrics-token-0123456789' });
    const fromApi = (
      await api
        .post(
          `${base()}/metrics`,
          {
            title: 'Активные',
            source: { kind: 'http_api.series', path: 'metrics/active' },
            connectionId: own,
          },
          owner.accessToken,
        )
        .expect(201)
    ).body as Metric;
    await eventually(async () => {
      expect((await series(fromApi.id)).map((p) => p.value)).toEqual([812]);
    }, 20_000);
  });

  it('lets only admins change official metrics', async () => {
    const tech = await addMember(techSession, 'tech');
    await api.get(`${base()}/metrics`, tech.accessToken).expect(200);
    await api.post(`${base()}/metrics`, { title: 'Моя' }, tech.accessToken).expect(403);
    const [first] = await metrics();
    await api.patch(`${base()}/metrics/${first!.id}`, { title: 'x' }, tech.accessToken).expect(403);
    await api
      .patch(`${base()}/metrics/${first!.id}`, { pinned: true, title: 'Выручка' }, owner.accessToken)
      .expect(200);
    // Agents read metrics, nothing in the broker writes them.
    const registry: unknown = worker.get(ToolRegistry);
    const writers = [...(registry as { tools: Map<string, unknown> }).tools.keys()];
    // panel_* run as the person the manager talks to (their role decides); none of them
    // creates or edits a metric definition either.
    expect(writers.filter((id) => /metric/.test(id) && !id.startsWith('panel_'))).toEqual(['metrics_read']);
    expect(writers.filter((id) => /^panel_.*metric/.test(id)).sort()).toEqual([
      'panel_collect_metric',
      'panel_list_metrics',
    ]);
  });

  it('builds the summary from pinned metrics, team cost and connections', async () => {
    const summary = (await api.get(`${base()}/summary?days=30`, owner.accessToken).expect(200)).body as {
      cards: Array<{
        metric: { key: string };
        value: number | null;
        periodDays: number;
        trend: string;
      }>;
      chart: { metric: { key: string }; points: Point[]; total: number | null } | null;
      connections: { total: number };
      team: { agents: number; agentsRub: number; revenueSharePct: number | null };
      hasMetrics: boolean;
    };
    expect(summary.hasMetrics).toBe(true);
    const revenue = summary.cards.find((c) => c.metric.key === 'revenue')!;
    expect(revenue.periodDays).toBe(30);
    expect(revenue.value).toBeCloseTo(1750.5);
    expect(summary.chart?.metric.key).toBe('revenue');
    expect(summary.chart?.total).toBeCloseTo(1750.5);
    expect(summary.chart?.points).toHaveLength(30);
    expect(summary.connections.total).toBe(4);
    expect(summary.team.agents).toBe(1);
    expect(summary.team.agentsRub).toBeGreaterThan(0);
    expect(summary.team.revenueSharePct).toBeGreaterThan(0);
  });

  it('turns a yes into an experiment, checks it on time and counts the confirmed effect', async () => {
    const task = (
      await api
        .post(`${base()}/tasks`, { agentId: intelId, title: 'Запустить акцию со скидкой' }, owner.accessToken)
        .expect(201)
    ).body as { id: string };
    const decisionId = await eventually(async () => {
      const body = (await api.get(`${base()}/tasks/${task.id}`, owner.accessToken).expect(200)).body as {
        status: string;
        decisionId: string | null;
      };
      if (body.status !== 'waiting' || !body.decisionId) throw new Error(body.status);
      return body.decisionId;
    }, 20_000);

    // Before the yes it is an experiment waiting for the owner.
    const before = (await api.get(`${base()}/summary`, owner.accessToken).expect(200)).body as {
      experiments: Array<{ status: string; decisionId: string | null }>;
    };
    expect(before.experiments).toContainEqual(expect.objectContaining({ status: 'pending', decisionId }));

    await api.post(`${base()}/decisions/${decisionId}/accept`, {}, owner.accessToken).expect(200);
    const db = superDb();
    const check = await eventually(async () => {
      const row = await db
        .selectFrom('checks')
        .selectAll()
        .where('decision_id', '=', decisionId)
        .executeTakeFirst();
      if (!row) throw new Error('no check');
      return row;
    });
    expect(check.status).toBe('pending');
    expect(check.due_at.getTime() - Date.now()).toBeGreaterThan(13 * DAY_MS);
    const idea = await db
      .selectFrom('ideas')
      .selectAll()
      .where('decision_id', '=', decisionId)
      .executeTakeFirstOrThrow();
    expect(idea).toMatchObject({ status: 'running', metric_key: 'revenue' });

    // record_check exists only inside a check task.
    const registry = worker.get(ToolRegistry);
    const agent = { id: intelId, kind: 'agent', templateKey: 'intel' } as never;
    expect(registry.available(agent, 'agent').map((t) => t.id)).not.toContain('record_check');
    expect(registry.available(agent, 'agent', [], { check: true }).map((t) => t.id)).toContain(
      'record_check',
    );

    // Time passes: the check comes due.
    await db
      .updateTable('scheduled_tasks')
      .set({ run_at: new Date(Date.now() - 1000) })
      .where('type', '=', 'checks.run')
      .where('dedupe_key', '=', check.id)
      .execute();
    await worker.get(ScheduledTasksSweeper).sweep();
    const done = await eventually(async () => {
      const row = await db
        .selectFrom('checks')
        .selectAll()
        .where('id', '=', check.id)
        .executeTakeFirstOrThrow();
      if (row.status !== 'done') throw new Error(row.status);
      return row;
    }, 20_000);
    expect(done.verdict).toBe('worked');
    const checkTask = (await api.get(`${base()}/tasks/${done.task_id}`, owner.accessToken).expect(200))
      .body as { origin: string; status: string };
    expect(checkTask).toMatchObject({ origin: 'check', status: 'done' });

    const results = (await api.get(`${base()}/results?days=30`, owner.accessToken).expect(200)).body as {
      metric: { key: string };
      brought: number;
      worked: number;
      payback: number | null;
      ideas: Array<{ status: string; effectValue: number | null; comparison: string | null }>;
      agents: Array<{ agentId: string; effect: number | null }>;
    };
    expect(results.metric.key).toBe('revenue');
    expect(results.brought).toBe(21000);
    expect(results.worked).toBe(1);
    expect(results.payback).toBeGreaterThan(0);
    expect(results.ideas[0]).toMatchObject({ status: 'adopted', effectValue: 21000 });
    expect(results.agents[0]).toMatchObject({ agentId: intelId, effect: 21000 });

    const stats = (await api.get(`${base()}/agents/${intelId}/stats`, owner.accessToken).expect(200))
      .body as {
      brought: number | null;
      streak: number;
      acceptedPct: number | null;
      streakTarget: number;
    };
    expect(stats).toMatchObject({ brought: 21000, streak: 1, acceptedPct: 100, streakTarget: 10 });
    await db.destroy();
  });

  it('publishes the insight of the day with how it was calculated', async () => {
    const task = (
      await api
        .post(`${base()}/tasks`, { agentId: intelId, title: 'Подвести итоги недели' }, owner.accessToken)
        .expect(201)
    ).body as { id: string };
    await eventually(async () => {
      const body = (await api.get(`${base()}/tasks/${task.id}`, owner.accessToken).expect(200)).body as {
        status: string;
      };
      if (body.status !== 'done') throw new Error(body.status);
    }, 20_000);
    const summary = (await api.get(`${base()}/summary`, owner.accessToken).expect(200)).body as {
      insight: { id: string; agentId: string; facts: Array<{ highlight: boolean }> } | null;
    };
    expect(summary.insight).toMatchObject({ agentId: intelId });
    const insight = (
      await api.get(`${base()}/insights/${summary.insight!.id}`, owner.accessToken).expect(200)
    ).body as { facts: Array<{ highlight: boolean }> };
    expect(insight.facts.some((f) => f.highlight)).toBe(true);
  });

  it('shows the journal of agent calls with filters and as CSV', async () => {
    // The intel agent of this file has no service connections: record two broker calls.
    const db = superDb();
    for (const [key, status] of [
      ['journal-ok-0001', 'executed'],
      ['journal-failed-1', 'failed'],
    ] as const) {
      await db
        .insertInto('tool_calls')
        .values({
          account_id: accountId,
          project_id: projectId,
          agent_id: intelId,
          tool_id: 'analytics.read',
          args: JSON.stringify({ days: 7 }),
          mode: 'auto',
          status,
          error_code: status === 'failed' ? 'PROVIDER_HTTP_500' : null,
          idempotency_key: key,
          result: status === 'executed' ? JSON.stringify({ visits: 140 }) : null,
        })
        .execute();
    }
    await db.destroy();
    const page = (await api.get(`${base()}/journal?period=today`, owner.accessToken).expect(200)).body as {
      items: Array<{ toolId: string; agentId: string; status: string }>;
      nextCursor: string | null;
    };
    expect(page.items.length).toBeGreaterThan(0);
    // Calls to services only (no Geniebox steps like record_check).
    expect(page.items.map((i) => i.toolId)).toContain('analytics.read');
    expect(page.items.every((i) => i.toolId.includes('.'))).toBe(true);
    const failed = (
      await api.get(`${base()}/journal?period=today&result=failed`, owner.accessToken).expect(200)
    ).body as { items: Array<{ status: string }> };
    expect(failed.items.every((i) => i.status === 'failed')).toBe(true);
    const csv = await api.get(`${base()}/journal.csv?period=today`, owner.accessToken).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\n')[0]).toBe('time,agent_id,tool,details,mode,status,error');

    const viewer = await addMember(viewerSession, 'viewer');
    await api.get(`${base()}/journal`, viewer.accessToken).expect(403);
    await api.get(`${base()}/summary`, viewer.accessToken).expect(200);
  });

  it('creates event partitions ahead and hides everything from other accounts', async () => {
    const result = await worker.get(MetricsMaintenance).run();
    expect(result.partitions).toBeGreaterThanOrEqual(0);
    const db = superDb();
    const month = new Date();
    month.setUTCMonth(month.getUTCMonth() + 2);
    const name = `events_${month.getUTCFullYear()}_${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
    const { rows } = await (
      await import('kysely')
    ).sql<{ exists: string | null }>`
      SELECT to_regclass(${name})::text AS exists
    `.execute(db);
    expect(rows[0]?.exists).toBe(name);
    await db.destroy();

    const stranger = strangerSession;
    const denied = (await api.get(`${base()}/metrics`, stranger.accessToken)).status;
    expect([403, 404]).toContain(denied);
    expect([403, 404]).toContain((await api.get(`${base()}/summary`, stranger.accessToken)).status);
    // Ids of this account do not resolve inside another account's project.
    const own = (
      (await api.post('/v1/accounts', { name: 'Чужой' }, stranger.accessToken).expect(201)).body as {
        id: string;
      }
    ).id;
    const ownProject = (
      (await api.post(`/v1/accounts/${own}/projects`, { name: 'Чужой' }, stranger.accessToken).expect(201))
        .body as { id: string }
    ).id;
    const theirs = `/v1/accounts/${own}/projects/${ownProject}`;
    await api.get(`${theirs}/agents/${intelId}/stats`, stranger.accessToken).expect(404);
    const mine = await metrics();
    await api.get(`${theirs}/metrics/${mine[0]!.id}/series`, stranger.accessToken).expect(404);
    const theirResults = (await api.get(`${theirs}/results`, stranger.accessToken).expect(200)).body as {
      ideas: unknown[];
    };
    expect(theirResults.ideas).toHaveLength(0);
  });
});
