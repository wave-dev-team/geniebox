import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../src/common/context/app-cls-store.js';
import { AgentsWorker } from '../../src/modules/agents/agents-worker.js';
import { MailModule } from '../../src/modules/mail/mail.module.js';
import { WorkerModule } from '../../src/worker.module.js';
import { asAccount, eventually, flushRedis, uniqueEmail } from '../support/helpers.js';
import { ApiHarness, type TokenPair } from '../support/http-app.js';

interface AgentBody {
  id: string;
  kind: string;
  templateKey: string | null;
  displayName: string;
  status: string;
  trustLevel: string;
  asks: string[];
  limits: Record<string, number | string>;
  connections: Array<{ connectionId: string; accessLevel: string }>;
  permissions: Array<{ actionId: string; mode: string; source: string; locked: boolean }>;
  enforcedAsks: string[];
}

const TOKEN = 'own-api-token-0123456789abcdef';

describe('agents (HTTP)', () => {
  let api: ApiHarness;
  let worker: TestingModule;
  let owner: TokenPair;
  let accountId: string;
  let projectId: string;
  let server: Server;
  let apiConnectionId: string;
  let botConnectionId: string;

  const base = (project = projectId) => `/v1/accounts/${accountId}/projects/${project}`;

  async function addMember(email: string, role: 'admin' | 'tech' | 'viewer'): Promise<TokenPair> {
    const before = api.mail.sent.length;
    await api.post(`/v1/accounts/${accountId}/invitations`, { email, role }, owner.accessToken).expect(201);
    const token = await api.mailMatch(email, /token=([A-Za-z0-9_-]+)/, before);
    const session = await api.signInWithCode(email);
    await api.post('/v1/invitations/accept', { token }, session.accessToken).expect(200);
    return session;
  }

  async function newProject(name: string): Promise<string> {
    return (
      (await api.post(`/v1/accounts/${accountId}/projects`, { name }, owner.accessToken).expect(201))
        .body as {
        id: string;
      }
    ).id;
  }

  async function agents(project = projectId): Promise<AgentBody[]> {
    return (await api.get(`${base(project)}/agents`, owner.accessToken).expect(200)).body as AgentBody[];
  }

  beforeAll(async () => {
    await flushRedis();
    server = createServer((req, res) => {
      res.statusCode = req.headers.authorization === `Bearer ${TOKEN}` ? 200 : 401;
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

    api = await ApiHarness.create();
    // The outbox relay and listeners: the manager and the onboarding team come from events.
    worker = await api.worker([WorkerModule, MailModule]);

    owner = await api.signInWithCode(uniqueEmail('a-owner'));
    accountId = (
      (await api.post('/v1/accounts', { name: 'Агенты' }, owner.accessToken).expect(201)).body as {
        id: string;
      }
    ).id;
    projectId = await newProject('Команда');

    apiConnectionId = (
      (
        await api
          .post(
            `${base()}/connections`,
            { providerKey: 'http_api', fields: { url, token: TOKEN } },
            owner.accessToken,
          )
          .expect(201)
      ).body as { connection: { id: string } }
    ).connection.id;
    botConnectionId = (
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
  });

  afterAll(async () => {
    await worker.close();
    await api.close();
    await new Promise((resolve) => server.close(resolve));
  });

  it('serves the marketplace catalog', async () => {
    const catalog = (await api.get('/v1/agent-catalog', owner.accessToken).expect(200)).body as {
      templates: Array<{ key: string; requirements: Array<{ key: string; required: boolean }> }>;
      tools: Array<{ id: string; systemDenied: boolean }>;
      skills: string[];
    };
    const support = catalog.templates.find((t) => t.key === 'support');
    expect(support?.requirements).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'channel', required: true })]),
    );
    expect(catalog.tools.find((t) => t.id === 'policy.update')?.systemDenied).toBe(true);
    expect(catalog.skills).toEqual(['surveys', 'promo', 'ab', 'digest', 'metrika_analysis', 'backlog_sync']);
  });

  it('gives every new project a manager and an analyst without requiring a connection', async () => {
    const project = await newProject('Новый проект без подключений');
    await eventually(async () => {
      const team = await agents(project);
      expect(team.map((a) => a.templateKey ?? a.kind).sort()).toEqual(['analyst', 'manager']);
    });
  });

  it('hires only with the required data connected', async () => {
    const missing = await api
      .post(`${base()}/agents`, { templateKey: 'support', connections: [] }, owner.accessToken)
      .expect(422);
    expect(missing.body).toMatchObject({ code: 'AGENT_REQUIREMENTS_MISSING' });

    const hired = (
      await api
        .post(
          `${base()}/agents`,
          {
            templateKey: 'support',
            connections: [
              { connectionId: botConnectionId, accessLevel: 'read_write' },
              { connectionId: apiConnectionId, accessLevel: 'read' },
            ],
          },
          owner.accessToken,
        )
        .expect(201)
    ).body as AgentBody;
    expect(hired).toMatchObject({
      templateKey: 'support',
      status: 'probation',
      trustLevel: 'approve_all',
      limits: { ai_budget_monthly: 3000 },
    });
    // Project rules are always on for the agent.
    expect(hired.asks).toEqual(expect.arrayContaining(['refund_any', 'discount_over_20', 'release_changes']));
    expect(hired.enforcedAsks).toContain('discount_over_20');
    expect(hired.permissions).toEqual(
      expect.arrayContaining([
        { actionId: 'bot.reply', risk: 'low', mode: 'notify', source: 'preset', locked: false },
        { actionId: 'api.call', risk: 'medium', mode: 'approve', source: 'preset', locked: false },
        { actionId: 'policy.update', risk: 'high', mode: 'deny', source: 'system', locked: true },
      ]),
    );

    const again = await api
      .post(`${base()}/agents`, { templateKey: 'support', connections: [] }, owner.accessToken)
      .expect(409);
    expect(again.body).toMatchObject({ code: 'AGENT_ALREADY_HIRED' });
  });

  it("refuses an access level above the connection's", async () => {
    const response = await api
      .post(
        `${base()}/agents`,
        {
          templateKey: 'intel',
          connections: [{ connectionId: apiConnectionId, accessLevel: 'read_write' }],
        },
        owner.accessToken,
      )
      .expect(400);
    expect(response.body).toMatchObject({ code: 'AGENT_CONNECTION_INVALID' });
  });

  it('changes permissions, keeps system locks and follows trust presets', async () => {
    const support = (await agents()).find((a) => a.templateKey === 'support')!;
    const url = `${base()}/agents/${support.id}`;

    const explicit = (
      await api
        .put(`${url}/permissions`, { items: [{ actionId: 'bot.reply', mode: 'auto' }] }, owner.accessToken)
        .expect(200)
    ).body as AgentBody;
    expect(explicit.permissions.find((p) => p.actionId === 'bot.reply')).toMatchObject({
      mode: 'auto',
      source: 'explicit',
    });

    const locked = await api
      .put(`${url}/permissions`, { items: [{ actionId: 'policy.update', mode: 'auto' }] }, owner.accessToken)
      .expect(403);
    expect(locked.body).toMatchObject({ code: 'AGENT_PERMISSION_LOCKED' });
    await api
      .put(`${url}/permissions`, { items: [{ actionId: 'code.mr.merge', mode: 'auto' }] }, owner.accessToken)
      .expect(400);

    const trusted = (await api.patch(url, { trustLevel: 'approve_important' }, owner.accessToken).expect(200))
      .body as AgentBody;
    expect(trusted.permissions.find((p) => p.actionId === 'api.call')).toMatchObject({
      mode: 'notify',
      source: 'preset',
    });

    const reset = (
      await api
        .put(`${url}/permissions`, { items: [{ actionId: 'bot.reply', mode: null }] }, owner.accessToken)
        .expect(200)
    ).body as AgentBody;
    expect(reset.permissions.find((p) => p.actionId === 'bot.reply')).toMatchObject({
      mode: 'auto',
      source: 'preset',
    });
  });

  it('updates instructions, limits and asks with validation', async () => {
    const support = (await agents()).find((a) => a.templateKey === 'support')!;
    const url = `${base()}/agents/${support.id}/rules`;
    const updated = (
      await api
        .patch(
          url,
          {
            instructions: [{ topic: 'Тон', rule: 'на «вы», коротко' }],
            limits: { ai_budget_monthly: 5000, quiet_hours: '22:00-09:00' },
            asks: ['refund_any'],
          },
          owner.accessToken,
        )
        .expect(200)
    ).body as AgentBody & { instructions: unknown };
    expect(updated).toMatchObject({
      instructions: [{ topic: 'Тон', rule: 'на «вы», коротко' }],
      limits: { ai_budget_monthly: 5000, quiet_hours: '22:00-09:00' },
      asks: ['refund_any'],
    });
    await api.patch(url, { limits: { quiet_hours: '25:00-09:00' } }, owner.accessToken).expect(400);
    await api.patch(url, { limits: { unknown_kind: 1 } }, owner.accessToken).expect(400);
    await api.patch(url, { asks: ['format_disk'] }, owner.accessToken).expect(400);
  });

  it('renames, changes the icon, pauses, resumes and fires', async () => {
    const support = (await agents()).find((a) => a.templateKey === 'support')!;
    const url = `${base()}/agents/${support.id}`;
    const renamed = (
      await api
        .patch(
          url,
          { displayName: 'Первая линия', icon: { kind: 'emoji', value: '🎧', bg: 'chart-2' } },
          owner.accessToken,
        )
        .expect(200)
    ).body as AgentBody & { icon: unknown };
    expect(renamed).toMatchObject({
      displayName: 'Первая линия',
      icon: { kind: 'emoji', value: '🎧', bg: 'chart-2' },
    });
    await api.patch(url, { icon: { kind: 'glyph', value: '<script>' } }, owner.accessToken).expect(400);

    expect((await api.post(`${url}/pause`, {}, owner.accessToken).expect(200)).body).toMatchObject({
      status: 'paused',
    });
    expect((await api.post(`${url}/resume`, {}, owner.accessToken).expect(200)).body).toMatchObject({
      status: 'probation',
    });

    const manager = (await agents()).find((a) => a.kind === 'manager')!;
    const immutable = await api
      .post(`${base()}/agents/${manager.id}/pause`, {}, owner.accessToken)
      .expect(409);
    expect(immutable.body).toMatchObject({ code: 'AGENT_MANAGER_IMMUTABLE' });
    await api.delete(`${base()}/agents/${manager.id}`, owner.accessToken).expect(409);

    await api.delete(url, owner.accessToken).expect(204);
    await api.get(url, owner.accessToken).expect(404);
    // A fired agent can be hired again.
    await api
      .post(
        `${base()}/agents`,
        {
          templateKey: 'support',
          connections: [
            { connectionId: botConnectionId, accessLevel: 'read' },
            { connectionId: apiConnectionId, accessLevel: 'read' },
          ],
        },
        owner.accessToken,
      )
      .expect(201);
  });

  it('creates a custom agent with the tools of its connections', async () => {
    const custom = (
      await api
        .post(
          `${base()}/agents`,
          {
            custom: {
              name: 'Менеджер по партнёрам',
              roleText: 'блогеры и партнёрства',
              icon: { kind: 'glyph', value: 'partner' },
              instructions: 'Пиши как новому сотруднику',
            },
            connections: [{ connectionId: botConnectionId, accessLevel: 'read' }],
          },
          owner.accessToken,
        )
        .expect(201)
    ).body as AgentBody;
    expect(custom).toMatchObject({ templateKey: null, displayName: 'Менеджер по партнёрам' });
    const tools = custom.permissions.map((p) => p.actionId);
    expect(tools).toEqual(expect.arrayContaining(['bot.reply', 'policy.update']));
    expect(tools).not.toContain('api.call');
  });

  it('applies the role matrix', async () => {
    const viewer = await addMember(uniqueEmail('a-viewer'), 'viewer');
    const tech = await addMember(uniqueEmail('a-tech'), 'tech');
    const someone = (await agents()).find((a) => a.kind === 'agent')!;
    await api.get(`${base()}/agents`, viewer.accessToken).expect(200);
    await api
      .post(`${base()}/agents`, { templateKey: 'intel', connections: [] }, tech.accessToken)
      .expect(403);
    await api.patch(`${base()}/agents/${someone.id}/rules`, { asks: [] }, tech.accessToken).expect(200);
    await api
      .patch(`${base()}/agents/${someone.id}`, { trustLevel: 'autonomous' }, tech.accessToken)
      .expect(403);
    await api.patch(`${base()}/agents/${someone.id}/rules`, { asks: [] }, viewer.accessToken).expect(403);
  });

  it('hires the onboarding team after onboarding is finished', async () => {
    const project = await newProject('Онбординг');
    await api
      .patch(
        base(project),
        { plannedAgents: ['analyst', 'intel', 'reviewer', 'unknown_agent'] },
        owner.accessToken,
      )
      .expect(200);
    await api.post(`${base(project)}/onboarding/complete`, {}, owner.accessToken).expect(200);
    await eventually(async () => {
      const keys = (await agents(project)).map((a) => a.templateKey ?? a.kind).sort();
      expect(keys).toEqual(['analyst', 'intel', 'manager', 'reviewer']);
    }, 15_000);
  });

  it('ends probation from the scheduled task', async () => {
    const intel = (
      await api
        .post(`${base()}/agents`, { templateKey: 'intel', connections: [] }, owner.accessToken)
        .expect(201)
    ).body as AgentBody;
    const runner = worker.get(AgentsWorker);
    await asAccount(worker.get<ClsService<AppClsStore>>(ClsService), accountId, () =>
      runner.endProbation(intel.id),
    );
    expect((await api.get(`${base()}/agents/${intel.id}`, owner.accessToken).expect(200)).body).toMatchObject(
      {
        status: 'active',
      },
    );
  });
});
