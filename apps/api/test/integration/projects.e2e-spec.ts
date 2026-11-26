import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../src/common/context/app-cls-store.js';
import { CoreModule } from '../../src/core.module.js';
import { SystemDb } from '../../src/database/system-db.js';
import { ProjectTasks } from '../../src/modules/projects/project-tasks.js';
import { ProjectsWorkerModule } from '../../src/modules/projects/projects.module.js';
import { asAccount, flushRedis, uniqueEmail } from '../support/helpers.js';
import { ApiHarness, type TokenPair } from '../support/http-app.js';

interface ProjectBody {
  id: string;
  accountId: string;
  slug: string;
  name: string;
  onboardingStep: number | null;
  agentsPaused: boolean;
  pausedUntil: string | null;
  [key: string]: unknown;
}

describe('projects (HTTP)', () => {
  let api: ApiHarness;
  let owner: TokenPair;
  let accountId: string;
  let project: ProjectBody;
  let worker: TestingModule;

  const base = (): string => `/v1/accounts/${accountId}/projects`;
  const one = (id = project.id): string => `${base()}/${id}`;

  async function addMember(email: string, role: 'admin' | 'tech' | 'viewer'): Promise<TokenPair> {
    const before = api.mail.sent.length;
    await api.post(`/v1/accounts/${accountId}/invitations`, { email, role }, owner.accessToken).expect(201);
    const token = await api.mailMatch(email, /token=([A-Za-z0-9_-]+)/, before);
    const session = await api.signInWithCode(email);
    await api.post('/v1/invitations/accept', { token }, session.accessToken).expect(200);
    return session;
  }

  beforeAll(async () => {
    await flushRedis();
    api = await ApiHarness.create();
    owner = await api.signInWithCode(uniqueEmail('p-owner'));
    accountId = (
      (await api.post('/v1/accounts', { name: 'Проекты' }, owner.accessToken).expect(201)).body as {
        id: string;
      }
    ).id;
    project = (
      await api
        .post(
          base(),
          { name: 'Мой Проект', sphere: 'subscription', goals: ['more_clients', 'less_churn'] },
          owner.accessToken,
        )
        .expect(201)
    ).body as ProjectBody;

    worker = await Test.createTestingModule({
      imports: [CoreModule, ProjectsWorkerModule],
    }).compile();
    Logger.overrideLogger(false);
    await worker.init();
  });

  afterAll(async () => {
    await worker.close();
    await api.close();
  });

  it('creates a project with defaults and onboarding at step 1', () => {
    expect(project).toMatchObject({
      accountId,
      name: 'Мой Проект',
      sphere: 'subscription',
      goals: ['more_clients', 'less_churn'],
      onboardingStep: 1,
      currency: 'RUB',
      timezone: 'Europe/Moscow',
      defaultTrustLevel: 'approve_all',
      alwaysAsk: ['discount_over_20', 'mailing_over_500', 'spend_over_10000', 'release_changes'],
      aiBudgetMonthly: 20000,
      agentsPaused: false,
    });
    expect(project.slug).toMatch(/^moy-proekt/);
  });

  it('keeps slugs globally unique and rejects a taken explicit slug', async () => {
    const otherOwner = await api.signInWithCode(uniqueEmail('p-other'));
    const otherAccount = (
      (await api.post('/v1/accounts', { name: 'Другой' }, otherOwner.accessToken).expect(201)).body as {
        id: string;
      }
    ).id;
    const second = (
      await api
        .post(`/v1/accounts/${otherAccount}/projects`, { name: 'Мой Проект' }, otherOwner.accessToken)
        .expect(201)
    ).body as ProjectBody;
    expect(second.slug).not.toBe(project.slug);

    const taken = await api.post(base(), { name: 'X', slug: project.slug }, owner.accessToken).expect(409);
    expect(taken.body).toMatchObject({ code: 'PROJECT_SLUG_TAKEN' });

    // Another account's project is invisible: same 404 as an unknown id.
    const foreign = await api.get(one(second.id), owner.accessToken).expect(404);
    expect(foreign.body).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it("lists projects of all the user's accounts for the switcher", async () => {
    const mine = await api.get('/v1/me/projects', owner.accessToken).expect(200);
    expect(mine.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: project.id,
          accountId,
          accountName: 'Проекты',
          role: 'owner',
          onboardingStep: 1,
        }),
      ]),
    );
  });

  it('updates general settings; empty strings clear optional text', async () => {
    const updated = await api
      .patch(
        one(),
        {
          monthGoal: '  +20% подписок  ',
          currency: 'USD',
          timezone: 'Asia/Almaty',
          clientTone: 'business',
          clientSignature: 'Команда',
          onboardingStep: 2,
        },
        owner.accessToken,
      )
      .expect(200);
    expect(updated.body).toMatchObject({
      monthGoal: '+20% подписок',
      currency: 'USD',
      timezone: 'Asia/Almaty',
      clientTone: 'business',
      clientSignature: 'Команда',
      onboardingStep: 2,
    });
    const cleared = await api.patch(one(), { clientSignature: '' }, owner.accessToken).expect(200);
    expect(cleared.body).toMatchObject({ clientSignature: null, currency: 'USD' });

    const invalid = await api.patch(one(), { timezone: 'Mars/Base' }, owner.accessToken).expect(400);
    expect(invalid.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    await api.patch(one(), { currency: 'BTC' }, owner.accessToken).expect(400);
  });

  it('updates rules for agents', async () => {
    const rules = await api
      .patch(
        `${one()}/rules`,
        {
          defaultTrustLevel: 'approve_all',
          probationDays: 14,
          trustStreak: 5,
          alwaysAsk: ['discount_over_20', 'publish_on_behalf'],
          agentRules: [' Никогда не упоминать конкурентов ', ''],
          aiBudgetMonthly: 15000,
        },
        owner.accessToken,
      )
      .expect(200);
    expect(rules.body).toMatchObject({
      defaultTrustLevel: 'approve_all',
      probationDays: 14,
      trustStreak: 5,
      alwaysAsk: ['discount_over_20', 'publish_on_behalf'],
      agentRules: ['Никогда не упоминать конкурентов'],
      aiBudgetMonthly: 15000,
    });
    await api.patch(`${one()}/rules`, { probationDays: 7 }, owner.accessToken).expect(400);
  });

  it('applies the role matrix: tech edits rules only, viewer reads only', async () => {
    const tech = await addMember(uniqueEmail('p-tech'), 'tech');
    const viewer = await addMember(uniqueEmail('p-viewer'), 'viewer');

    await api.get(one(), viewer.accessToken).expect(200);
    const denied = await api.patch(one(), { name: 'Нет' }, tech.accessToken).expect(403);
    expect(denied.body).toMatchObject({ code: 'ACCOUNT_ROLE_REQUIRED' });
    await api.patch(`${one()}/rules`, { trustStreak: 20 }, tech.accessToken).expect(200);
    await api.patch(`${one()}/rules`, { trustStreak: 10 }, viewer.accessToken).expect(403);
    await api.post(base(), { name: 'Новый' }, tech.accessToken).expect(403);
    await api.post(`${one()}/pause`, {}, viewer.accessToken).expect(403);
  });

  it('finishes onboarding once and never reopens it', async () => {
    await api.patch(one(), { plannedAgents: ['support', 'analyst'] }, owner.accessToken).expect(200);
    const done = await api.post(`${one()}/onboarding/complete`, {}, owner.accessToken).expect(200);
    expect(done.body).toMatchObject({ onboardingStep: null, plannedAgents: ['support', 'analyst'] });
    expect((done.body as ProjectBody).onboardingCompletedAt).toEqual(expect.any(String));

    const late = await api.patch(one(), { onboardingStep: 4 }, owner.accessToken).expect(200);
    expect(late.body).toMatchObject({ onboardingStep: null });
    await api.post(`${one()}/onboarding/complete`, {}, owner.accessToken).expect(200);
  });

  it('pauses and resumes the team; a timed pause resumes from the scheduled task', async () => {
    const paused = await api.post(`${one()}/pause`, {}, owner.accessToken).expect(200);
    expect(paused.body).toMatchObject({ agentsPaused: true, pausedUntil: null });
    const resumed = await api.post(`${one()}/resume`, {}, owner.accessToken).expect(200);
    expect(resumed.body).toMatchObject({ agentsPaused: false });

    const until = new Date(Date.now() + 60 * 60 * 1000);
    const timed = (
      await api.post(`${one()}/pause`, { until: until.toISOString() }, owner.accessToken).expect(200)
    ).body as ProjectBody;
    expect(new Date(timed.pausedUntil as string).getTime()).toBe(until.getTime());

    const tasks = worker.get(ProjectTasks);
    const cls = worker.get<ClsService<AppClsStore>>(ClsService);
    // A task for an older pause does nothing.
    await asAccount(cls, accountId, () => tasks.resume(project.id, new Date(until.getTime() - 1)));
    expect((await api.get(one(), owner.accessToken).expect(200)).body).toMatchObject({
      agentsPaused: true,
    });
    await asAccount(cls, accountId, () => tasks.resume(project.id, until));
    expect((await api.get(one(), owner.accessToken).expect(200)).body).toMatchObject({
      agentsPaused: false,
      pausedUntil: null,
    });
  });

  it('deletes softly by the owner with the typed name, then purges', async () => {
    const admin = await addMember(uniqueEmail('p-admin'), 'admin');
    const victim = (await api.post(base(), { name: 'На удаление' }, admin.accessToken).expect(201))
      .body as ProjectBody;

    await api.delete(one(victim.id), admin.accessToken).send({ confirmName: 'На удаление' }).expect(403);
    const mismatch = await api
      .delete(one(victim.id), owner.accessToken)
      .send({ confirmName: 'Другое' })
      .expect(422);
    expect(mismatch.body).toMatchObject({ code: 'PROJECT_NAME_MISMATCH' });

    await api.delete(one(victim.id), owner.accessToken).send({ confirmName: 'На удаление' }).expect(204);
    await api.get(one(victim.id), owner.accessToken).expect(404);
    const mine = (await api.get('/v1/me/projects', owner.accessToken).expect(200)).body as Array<{
      id: string;
    }>;
    expect(mine.map((item) => item.id)).not.toContain(victim.id);

    // The slug is free again once the project is deleted.
    await api.post(base(), { name: 'Снова', slug: victim.slug }, owner.accessToken).expect(201);

    const systemDb = worker.get(SystemDb);
    const task = await systemDb.db
      .selectFrom('scheduled_tasks')
      .select(['type', 'run_at'])
      .where('account_id', '=', accountId)
      .where('type', '=', 'projects.purge')
      .executeTakeFirstOrThrow();
    expect(task.run_at.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);

    const tasks = worker.get(ProjectTasks);
    const cls = worker.get<ClsService<AppClsStore>>(ClsService);
    await asAccount(cls, accountId, () => tasks.purge(victim.id));
    const row = await systemDb.db
      .selectFrom('projects')
      .select('id')
      .where('id', '=', victim.id)
      .executeTakeFirst();
    expect(row).toBeUndefined();
    // Purging a live project is a no-op.
    await asAccount(cls, accountId, () => tasks.purge(project.id));
    await api.get(one(), owner.accessToken).expect(200);
  });

  it('enforces the per-account project limit', async () => {
    const limitOwner = await api.signInWithCode(uniqueEmail('p-limit'));
    const id = (
      (await api.post('/v1/accounts', { name: 'Лимит' }, limitOwner.accessToken).expect(201)).body as {
        id: string;
      }
    ).id;
    for (let index = 0; index < 10; index += 1) {
      await api
        .post(`/v1/accounts/${id}/projects`, { name: `P${index}` }, limitOwner.accessToken)
        .expect(201);
    }
    const over = await api
      .post(`/v1/accounts/${id}/projects`, { name: 'P10' }, limitOwner.accessToken)
      .expect(409);
    expect(over.body).toMatchObject({ code: 'PROJECT_LIMIT_REACHED' });
  });

  describe('support requests', () => {
    it('stores a support question and mails the support inbox', async () => {
      const before = api.mail.sent.length;
      const created = await api
        .post(
          '/v1/support/requests',
          {
            kind: 'support',
            projectId: project.id,
            topic: 'connections',
            message: 'Не подключается Stripe',
            attachJournal: true,
          },
          owner.accessToken,
        )
        .expect(201);
      expect(created.body).toMatchObject({ id: expect.any(String) });
      const projectName = await api.mailMatch(
        'support@geniebox.local',
        /Проект: (.+)\n[\s\S]*Не подключается Stripe/,
        before,
      );
      expect(projectName).toBe('Мой Проект');
    });

    it('accepts a turnkey request and hides foreign projects', async () => {
      await api
        .post(
          '/v1/support/requests',
          {
            kind: 'turnkey',
            services: ['bot_crm', 'payments'],
            message: 'Настройте всё',
            contact: '@me',
          },
          owner.accessToken,
        )
        .expect(201);
      const stranger = await api.signInWithCode(uniqueEmail('p-stranger'));
      await api
        .post(
          '/v1/support/requests',
          { kind: 'support', projectId: project.id, message: '?' },
          stranger.accessToken,
        )
        .expect(404);
      await api.post('/v1/support/requests', { kind: 'support', message: '' }, owner.accessToken).expect(400);
    });
  });
});
