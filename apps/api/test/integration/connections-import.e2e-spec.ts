import { jest } from '@jest/globals';

import type { TestingModule } from '@nestjs/testing';

import { buildFragments, type ImportResult, importSkeleton } from '@workspace/types';

import { MailModule } from '../../src/modules/mail/mail.module.js';
import {
  LLM_PROVIDER,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from '../../src/modules/runtime/llm/llm.types.js';
import { WorkerModule } from '../../src/worker.module.js';
import { connectAs, eventually, flushRedis, infra, uniqueEmail } from '../support/helpers.js';
import { ApiHarness, type TokenPair } from '../support/http-app.js';

interface JobStatus {
  status: 'queued' | 'running' | 'done' | 'failed';
  result: ImportResult | null;
  error: string | null;
}

interface GroupResult {
  providerKey: string;
  outcome: 'created' | 'replaced' | 'skipped' | 'unchanged' | 'failed';
  connectionId: string | null;
  status: string | null;
  masked: string | null;
  error: { code: string; field?: string } | null;
}

const TELEGRAM_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
/** Who the values belong to: they must never reach the model, the job or an answer. */
const VALUES = ['123456', 'test_secret_key_0123456789', TELEGRAM_TOKEN];
const BUFFER = [
  'YOOKASSA_SHOP_ID=123456',
  'YOOKASSA_SECRET_KEY=test_secret_key_0123456789',
  TELEGRAM_TOKEN,
].join('\n');

/** Superuser on the test database: reads across RLS for assertions. */
function superDb() {
  const url = new URL(infra().adminUrl);
  url.pathname = `/${infra().database}`;
  return connectAs(url.toString());
}

describe('connections import (HTTP, fake model)', () => {
  let api: ApiHarness;
  let worker: TestingModule;
  let owner: TokenPair;
  let accountId: string;
  let projectId: string;

  const base = () => `/v1/accounts/${accountId}/projects/${projectId}`;
  const fragments = buildFragments(BUFFER);
  const skeleton = importSkeleton(fragments);

  async function status(jobId: string, token = owner.accessToken): Promise<JobStatus> {
    return (await api.get(`${base()}/connections/import/analyze/${jobId}`, token).expect(200))
      .body as JobStatus;
  }

  async function finished(jobId: string): Promise<ImportResult> {
    return eventually(async () => {
      const current = await status(jobId);
      expect(current.status).toBe('done');
      expect(current.result).not.toBeNull();
      return current.result!;
    });
  }

  beforeAll(async () => {
    await flushRedis();
    api = await ApiHarness.create();
    worker = await api.worker([WorkerModule, MailModule]);

    owner = await api.signInWithCode(uniqueEmail('ci-owner'));
    accountId = (
      (await api.post('/v1/accounts', { name: 'Импорт' }, owner.accessToken).expect(201)).body as {
        id: string;
      }
    ).id;
    projectId = (
      (
        await api
          .post(`/v1/accounts/${accountId}/projects`, { name: 'Магазин' }, owner.accessToken)
          .expect(201)
      ).body as { id: string }
    ).id;
  });

  afterAll(async () => {
    await worker.close();
    await api.close();
  });

  it('analyzes names without values, asks about the unnamed one and takes the answer', async () => {
    // The buffer splits into minimal values with stable ids; only names and shapes go out.
    expect(fragments.map((fragment) => fragment.id)).toEqual(['f1', 'f2', 'f3']);
    expect(JSON.stringify(skeleton)).not.toContain('test_secret_key_0123456789');

    const provider = worker.get<LlmProvider>(LLM_PROVIDER);
    const ask = provider.complete.bind(provider);
    const spy = jest
      .spyOn(provider, 'complete')
      .mockImplementation(async (request: LlmRequest): Promise<LlmResponse> => {
        const clarified = request.messages.some(
          (message) => 'content' in message && message.content.includes("Person's answer:"),
        );
        if (request.role === 'connections.import' && clarified) {
          return {
            text: '',
            toolCalls: [
              {
                id: 'call_clarify',
                name: 'propose_credentials',
                arguments: JSON.stringify({
                  items: [
                    {
                      providerKey: 'telegram_bot',
                      fields: [{ field: 'token', fragment: 'f3' }],
                      confidence: 'high',
                    },
                  ],
                  questions: [],
                  notes: [],
                }),
              },
            ],
            usage: { tokensIn: 40, tokensOut: 20 },
          };
        }
        return ask(request);
      });

    try {
      const accepted = await api
        .post(`${base()}/connections/import/analyze`, { skeleton }, owner.accessToken)
        .expect(202);
      const first = await finished((accepted.body as { jobId: string }).jobId);

      expect(first.items).toEqual([
        expect.objectContaining({
          providerKey: 'yookassa',
          confidence: 'low',
          missing: [],
          fields: [
            { field: 'shop_id', fragment: 'f1' },
            { field: 'secret_key', fragment: 'f2' },
          ],
        }),
      ]);
      // The bare token has no name: the model does not guess a service, it asks.
      expect(first.questions).toHaveLength(1);
      expect(first.questions[0]).toMatchObject({ fragments: ['f3'], turn: 1 });
      expect(first.questions[0]!.options).toEqual(expect.arrayContaining(['telegram_bot']));
      expect(first.unmatched).toEqual([]);

      const answered = await api
        .post(
          `${base()}/connections/import/clarify`,
          {
            skeleton,
            answer: 'Это токен Telegram-бота',
            question: first.questions[0]!.text,
            previous: first,
          },
          owner.accessToken,
        )
        .expect(202);
      const second = await finished((answered.body as { jobId: string }).jobId);
      expect(second.items).toEqual([
        expect.objectContaining({
          providerKey: 'telegram_bot',
          confidence: 'high',
          fields: [{ field: 'token', fragment: 'f3' }],
        }),
      ]);
      expect(second.questions).toEqual([]);

      // What the model saw and what the popup got back never contains a value.
      const prompts = spy.mock.calls
        .map(([request]) => request.messages.map((message) => ('content' in message ? message.content : '')))
        .join('\n');
      for (const value of VALUES) {
        expect(prompts).not.toContain(value);
        expect(JSON.stringify(first)).not.toContain(value);
        expect(JSON.stringify(second)).not.toContain(value);
      }
      expect(prompts).toContain("Person's answer: Это токен Telegram-бота");
      expect(prompts).toContain('"prefix"');

      const db = superDb();
      try {
        const calls = await db
          .selectFrom('llm_calls')
          .select(['role', 'prompt_version', 'result'])
          .where('project_id', '=', projectId)
          .orderBy('created_at')
          .execute();
        expect(calls).toEqual([
          { role: 'connections.import', prompt_version: 'connections.import@1', result: 'ok' },
          { role: 'connections.import', prompt_version: 'connections.import@1', result: 'ok' },
        ]);
      } finally {
        await db.destroy();
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('saves the groups, skips or replaces them, and reports bad providers per group', async () => {
    const groups = [
      { providerKey: 'yookassa', fields: { shop_id: '123456', secret_key: 'test_secret_key_0123456789' } },
      { providerKey: 'telegram_bot', fields: { token: TELEGRAM_TOKEN } },
    ];

    const created = (
      await api.post(`${base()}/connections/import`, { groups }, owner.accessToken).expect(201)
    ).body as { items: GroupResult[] };
    expect(created.items.map((item) => item.outcome)).toEqual(['created', 'created']);
    expect(created.items.map((item) => item.providerKey)).toEqual(['yookassa', 'telegram_bot']);
    expect(created.items[0]).toMatchObject({
      status: 'pending',
      masked: expect.stringMatching(/6789$/),
      error: null,
    });
    expect(JSON.stringify(created)).not.toContain('test_secret_key_0123456789');
    expect(JSON.stringify(created)).not.toContain(TELEGRAM_TOKEN);

    const ids = created.items.map((item) => item.connectionId);

    // «Пропустить» keeps what is already there.
    const skipped = (
      await api.post(`${base()}/connections/import`, { groups, mode: 'skip' }, owner.accessToken).expect(201)
    ).body as { items: GroupResult[] };
    expect(skipped.items.map((item) => item.outcome)).toEqual(['skipped', 'skipped']);
    expect(skipped.items.map((item) => item.connectionId)).toEqual(ids);

    // «Заменить» rotates the credential of the same connection.
    const replaced = (
      await api
        .post(`${base()}/connections/import`, { groups, mode: 'replace' }, owner.accessToken)
        .expect(201)
    ).body as { items: GroupResult[] };
    expect(replaced.items.map((item) => item.outcome)).toEqual(['replaced', 'replaced']);
    expect(replaced.items.map((item) => item.connectionId)).toEqual(ids);

    // A group the catalog does not know fails alone: the others are saved.
    const mixed = (
      await api
        .post(
          `${base()}/connections/import`,
          {
            groups: [
              ...groups,
              { providerKey: 'unknown_service', fields: { token: 'x'.repeat(20) } },
              { providerKey: 'telegram_bot', fields: { token: 'not-a-bot-token' } },
            ],
          },
          owner.accessToken,
        )
        .expect(201)
    ).body as { items: GroupResult[] };
    expect(mixed.items.slice(2)).toEqual([
      expect.objectContaining({
        providerKey: 'unknown_service',
        outcome: 'failed',
        error: { code: 'CONNECTION_PROVIDER_UNKNOWN' },
      }),
      expect.objectContaining({
        providerKey: 'telegram_bot',
        outcome: 'failed',
        error: { code: 'CONNECTION_FIELDS_INVALID' },
      }),
    ]);

    const listed = (await api.get(`${base()}/connections`, owner.accessToken).expect(200)).body as Array<{
      id: string;
      providerKey: string;
    }>;
    expect(listed.map((item) => item.providerKey).sort()).toEqual(['telegram_bot', 'yookassa']);
  });

  it('keeps a job inside the project that asked for it', async () => {
    const accepted = await api
      .post(`${base()}/connections/import/analyze`, { skeleton }, owner.accessToken)
      .expect(202);
    const jobId = (accepted.body as { jobId: string }).jobId;
    await finished(jobId);

    const stranger = await api.signInWithCode(uniqueEmail('ci-stranger'));
    const ownAccount = (
      (await api.post('/v1/accounts', { name: 'Чужой' }, stranger.accessToken).expect(201)).body as {
        id: string;
      }
    ).id;
    const ownProject = (
      (
        await api
          .post(`/v1/accounts/${ownAccount}/projects`, { name: 'Чужой' }, stranger.accessToken)
          .expect(201)
      ).body as { id: string }
    ).id;
    await api
      .get(
        `/v1/accounts/${ownAccount}/projects/${ownProject}/connections/import/analyze/${jobId}`,
        stranger.accessToken,
      )
      .expect(404);

    // The skeleton is validated before a job exists.
    const invalid = await api
      .post(`${base()}/connections/import/analyze`, { skeleton: { fragments: [] } }, owner.accessToken)
      .expect(400);
    expect(invalid.body).toMatchObject({ code: 'CONNECTION_IMPORT_INVALID' });
  });
});
