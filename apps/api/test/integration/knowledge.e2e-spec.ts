import ExcelJS from 'exceljs';

import type { TestingModule } from '@nestjs/testing';

import { WorkerModule } from '../../src/worker.module.js';
import { connectAs, eventually, flushRedis, infra, uniqueEmail } from '../support/helpers.js';
import { ApiHarness, type TokenPair } from '../support/http-app.js';

interface Node {
  id: string;
  parentId: string | null;
  kind: 'folder' | 'page';
  title: string;
  body: string;
  status: 'draft' | 'published' | 'archived';
  sourceId: string | null;
}

interface Source {
  id: string;
  title: string;
  status: string;
  error: string | null;
}

interface SearchResponse {
  items: Array<{ nodeId: string; title: string; snippet: string; sourceIds: string[] }>;
}

describe('knowledge base (HTTP)', () => {
  let api: ApiHarness;
  let worker: TestingModule;
  let owner: TokenPair;
  let viewer: TokenPair;
  let stranger: TokenPair;
  let accountId: string;
  let projectId: string;

  const base = () => `/v1/accounts/${accountId}/projects/${projectId}/knowledge`;
  const markdown =
    '# Конверсия\n\nКонверсия — доля заказов от визитов.\n\n## Сезонность\n\nВ октябре конверсия падает.';

  async function upload(token: string, title: string, filename: string, data: Buffer) {
    return api
      .post(
        `${base()}/sources`,
        { kind: 'upload', title, filename, contentBase64: data.toString('base64') },
        token,
      )
      .expect(202);
  }

  async function waitForSource(token: string, status: string): Promise<Source> {
    return eventually(async () => {
      const list = (await api.get(`${base()}/sources`, token).expect(200)).body as Source[];
      const source = list.find((item) => item.status === status);
      if (!source) throw new Error(`no source in status ${status}: ${JSON.stringify(list)}`);
      return source;
    }, 20_000);
  }

  async function nodes(token: string): Promise<Node[]> {
    return (await api.get(`${base()}/nodes`, token).expect(200)).body as Node[];
  }

  async function search(token: string, q: string): Promise<SearchResponse> {
    return (await api.get(`${base()}/search?q=${encodeURIComponent(q)}`, token).expect(200))
      .body as SearchResponse;
  }

  beforeAll(async () => {
    await flushRedis();
    api = await ApiHarness.create();
    owner = await api.signInWithCode(uniqueEmail('k-owner'));
    viewer = await api.signInWithCode(uniqueEmail('k-viewer'));
    stranger = await api.signInWithCode(uniqueEmail('k-stranger'));
    worker = await api.worker([WorkerModule]);

    accountId = (
      (await api.post('/v1/accounts', { name: 'Knowledge' }, owner.accessToken).expect(201)).body as {
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

    const admin = connectAs(infra().adminUrl.replace(/\/[^/]*$/, `/${infra().database}`));
    try {
      await admin
        .insertInto('account_members')
        .values({ account_id: accountId, user_id: viewer.userId, role: 'viewer' })
        .execute();
    } finally {
      await admin.destroy();
    }
  });

  afterAll(async () => {
    await worker?.close();
    await api?.close();
  });

  it('rejects a format it cannot read, before anything is stored', async () => {
    const response = await api.post(
      `${base()}/sources`,
      {
        kind: 'upload',
        filename: 'report.pdf',
        contentBase64: Buffer.from('%PDF-1.7').toString('base64'),
      },
      owner.accessToken,
    );
    expect(response.status).toBe(415);
    expect(response.body.code).toBe('KNOWLEDGE_SOURCE_FORMAT_UNSUPPORTED');
  });

  it('extracts a markdown source into draft pages and citations', async () => {
    await upload(owner.accessToken, 'Правила конверсии', 'conversion.md', Buffer.from(markdown, 'utf8'));
    const source = await waitForSource(owner.accessToken, 'ready');
    const drafts = await eventually(async () => {
      const list = (await nodes(owner.accessToken)).filter((node) => node.status === 'draft');
      if (!list.some((node) => node.kind === 'page')) throw new Error('drafts are not ready');
      return list;
    });
    expect(drafts.some((node) => node.kind === 'folder' && node.sourceId === source.id)).toBe(true);
    const page = drafts.find((node) => node.kind === 'page')!;
    expect(page.body).toContain('доля заказов');
    expect(page.sourceId).toBe(source.id);
  });

  it('does not process the same bytes twice', async () => {
    const first = (await api.get(`${base()}/sources`, owner.accessToken).expect(200)).body as Source[];
    await upload(owner.accessToken, 'Правила конверсии', 'conversion.md', Buffer.from(markdown, 'utf8'));
    const second = (await api.get(`${base()}/sources`, owner.accessToken).expect(200)).body as Source[];
    expect(second).toHaveLength(first.length);
    expect(second[0]!.id).toBe(first[0]!.id);
  });

  it('shows drafts to the team but not to a viewer', async () => {
    expect((await nodes(viewer.accessToken)).filter((node) => node.status === 'draft')).toEqual([]);
  });

  it('refuses publication by a viewer and empty pages', async () => {
    const draft = (await nodes(owner.accessToken)).find((node) => node.kind === 'page')!;
    await api.post(`${base()}/nodes/${draft.id}/publish`, {}, viewer.accessToken).expect(403);

    const empty = (
      await api
        .post(`${base()}/nodes`, { kind: 'page', title: 'Пустая страница' }, owner.accessToken)
        .expect(201)
    ).body as Node;
    const response = await api.post(`${base()}/nodes/${empty.id}/publish`, {}, owner.accessToken);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('KNOWLEDGE_BODY_REQUIRED');
  });

  it('indexes a published page and finds it, then hides it when archived', async () => {
    const draft = (await nodes(owner.accessToken)).find(
      (node) => node.kind === 'page' && node.status === 'draft' && node.title !== 'Пустая страница',
    )!;
    await api.post(`${base()}/nodes/${draft.id}/publish`, {}, owner.accessToken).expect(201);

    const found = await eventually(async () => {
      const result = await search(owner.accessToken, 'почему падает конверсия');
      if (!result.items.length) throw new Error('published page is not indexed yet');
      return result;
    }, 20_000);
    expect(found.items[0]!.nodeId).toBe(draft.id);
    expect(found.items[0]!.sourceIds.length).toBeGreaterThan(0);

    const visible = (await nodes(viewer.accessToken)).map((node) => node.id);
    expect(visible).toContain(draft.id);

    await api.post(`${base()}/nodes/${draft.id}/archive`, {}, owner.accessToken).expect(201);
    const afterArchive = await eventually(async () => {
      const result = await search(owner.accessToken, 'почему падает конверсия');
      if (result.items.length) throw new Error('archived page is still searchable');
      return result;
    }, 20_000);
    expect(afterArchive.items).toEqual([]);
  });

  it('extracts a spreadsheet into pages per sheet', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Метрики');
    sheet.addRow(['Показатель', 'Сентябрь', 'Октябрь']);
    sheet.addRow(['Выручка', '1200000', '980000']);
    sheet.addRow(['Конверсия', '2.4', '1.9']);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());

    await upload(owner.accessToken, 'Датасет продаж', 'dataset.xlsx', bytes);
    const pages = await eventually(async () => {
      const list = (await nodes(owner.accessToken)).filter(
        (node) => node.kind === 'page' && node.title.includes('Метрики'),
      );
      if (!list.length) throw new Error('sheet page is not extracted yet');
      return list;
    }, 20_000);
    expect(pages[0]!.body).toContain('| Выручка | 1200000 | 980000 |');
    expect(pages[0]!.status).toBe('draft');
  });

  it('keeps the tree acyclic', async () => {
    const parent = (
      await api.post(`${base()}/nodes`, { kind: 'folder', title: 'Родитель' }, owner.accessToken).expect(201)
    ).body as Node;
    const child = (
      await api
        .post(`${base()}/nodes`, { kind: 'folder', title: 'Ребёнок', parentId: parent.id }, owner.accessToken)
        .expect(201)
    ).body as Node;
    const response = await api.patch(
      `${base()}/nodes/${parent.id}`,
      { parentId: child.id },
      owner.accessToken,
    );
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('KNOWLEDGE_CYCLE');
  });

  it('isolates projects of other accounts', async () => {
    const node = (await nodes(owner.accessToken))[0]!;
    const otherAccount = (
      (await api.post('/v1/accounts', { name: 'Other' }, stranger.accessToken).expect(201)).body as {
        id: string;
      }
    ).id;
    const otherProject = (
      (
        await api
          .post(`/v1/accounts/${otherAccount}/projects`, { name: 'Other' }, stranger.accessToken)
          .expect(201)
      ).body as { id: string }
    ).id;
    await api
      .get(
        `/v1/accounts/${otherAccount}/projects/${otherProject}/knowledge/nodes/${node.id}`,
        stranger.accessToken,
      )
      .expect(404);
    await api.get(`${base()}/nodes`, stranger.accessToken).expect(404);
  });
});
