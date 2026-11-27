import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { sql } from 'kysely';

import { ConnectionsMaintenance } from '../../src/modules/connections/connections-maintenance.js';
import { assertPublicHost } from '../../src/modules/connections/providers/egress.js';
import { connectAs, flushRedis, infra, uniqueEmail } from '../support/helpers.js';
import { ApiHarness, type TokenPair } from '../support/http-app.js';

interface ConnectionBody {
  id: string;
  providerKey: string;
  status: string;
  statusReason: string | null;
  config: Record<string, string>;
  credential: { version: number; masked: string } | null;
}
interface WithCheck {
  connection: ConnectionBody;
  check: { status: string; reason: string | null } | null;
}

const GOOD_TOKEN = 'own-api-token-0123456789abcdef';

describe('connections (HTTP)', () => {
  let api: ApiHarness;
  let owner: TokenPair;
  const ownerEmail = uniqueEmail('c-owner');
  let accountId: string;
  let projectId: string;
  let server: Server;
  let apiUrl: string;
  // Superuser on the test database: reads across RLS to inspect what is stored.
  const inspectDb = () => {
    const url = new URL(infra().adminUrl);
    url.pathname = `/${infra().database}`;
    return connectAs(url.toString());
  };

  const base = () => `/v1/accounts/${accountId}/projects/${projectId}/connections`;

  async function addMember(email: string, role: 'admin' | 'tech' | 'viewer'): Promise<TokenPair> {
    const before = api.mail.sent.length;
    await api.post(`/v1/accounts/${accountId}/invitations`, { email, role }, owner.accessToken).expect(201);
    const token = await api.mailMatch(email, /token=([A-Za-z0-9_-]+)/, before);
    const session = await api.signInWithCode(email);
    await api.post('/v1/invitations/accept', { token }, session.accessToken).expect(200);
    return session;
  }

  async function connectOwnApi(token: string): Promise<WithCheck> {
    return (
      await api
        .post(base(), { providerKey: 'http_api', fields: { url: apiUrl, token } }, owner.accessToken)
        .expect(201)
    ).body as WithCheck;
  }

  beforeAll(async () => {
    await flushRedis();
    // A stand-in for a customer's own API: 200 with the right bearer token, 401 otherwise.
    server = createServer((req, res) => {
      res.statusCode = req.headers.authorization === `Bearer ${GOOD_TOKEN}` ? 200 : 401;
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/health`;

    api = await ApiHarness.create();
    owner = await api.signInWithCode(ownerEmail);
    accountId = (
      (await api.post('/v1/accounts', { name: 'Подключения' }, owner.accessToken).expect(201)).body as {
        id: string;
      }
    ).id;
    projectId = (
      (
        await api
          .post(`/v1/accounts/${accountId}/projects`, { name: 'Проект' }, owner.accessToken)
          .expect(201)
      ).body as { id: string }
    ).id;
  });

  afterAll(async () => {
    await api.close();
    await new Promise((resolve) => server.close(resolve));
  });

  it('lists the provider catalog with categories and fields', async () => {
    const response = await api.get('/v1/connection-providers', owner.accessToken).expect(200);
    const keys = (response.body as Array<{ key: string }>).map((p) => p.key);
    expect(keys).toEqual(
      expect.arrayContaining(['telegram_bot', 'yookassa', 'postgres', 'ssh_server', 'http_api']),
    );
    const telegram = (response.body as Array<{ key: string; category: string; weight: number }>).find(
      (p) => p.key === 'telegram_bot',
    );
    expect(telegram).toMatchObject({ category: 'bot_crm', weight: 30 });
  });

  it('connects a service, seals the secret and checks it at once', async () => {
    const created = await connectOwnApi(GOOD_TOKEN);
    expect(created.check).toMatchObject({ status: 'ok' });
    expect(created.connection).toMatchObject({
      providerKey: 'http_api',
      status: 'ok',
      config: { url: apiUrl },
      credential: { version: 1, masked: '••••cdef' },
    });
    expect(JSON.stringify(created)).not.toContain(GOOD_TOKEN);

    const db = inspectDb();
    try {
      const row = await db
        .selectFrom('connection_credentials')
        .select(['ciphertext', 'kek_id'])
        .where('connection_id', '=', created.connection.id)
        .executeTakeFirstOrThrow();
      expect(row.ciphertext.toString('utf8')).not.toContain(GOOD_TOKEN);
      expect(row.kek_id).toMatch(/^[0-9a-f]{16}$/);
      const leaked = await db
        .selectFrom('action_journal')
        .select('id')
        .where(sql<string>`concat(args::text, result::text)`, 'like', `%${GOOD_TOKEN}%`)
        .execute();
      expect(leaked).toHaveLength(0);
    } finally {
      await db.destroy();
    }

    const summary = await api.get(`${base()}/summary`, owner.accessToken).expect(200);
    expect(summary.body).toMatchObject({ coveragePct: 10, working: 1, attention: 0 });
  });

  it('reports a failed check and recovers after a key rotation', async () => {
    const created = await connectOwnApi('wrong-token-0000000000000000');
    expect(created.connection).toMatchObject({ status: 'error', statusReason: 'UNAUTHORIZED' });

    const rotated = (
      await api
        .post(
          `${base()}/${created.connection.id}/rotate`,
          { fields: { token: GOOD_TOKEN } },
          owner.accessToken,
        )
        .expect(200)
    ).body as WithCheck;
    expect(rotated.connection).toMatchObject({ status: 'ok', credential: { version: 2 } });

    // The replaced credential lives until its grace period ends, then maintenance destroys it.
    const db = inspectDb();
    try {
      const versions = await db
        .selectFrom('connection_credentials')
        .select(['version', 'status'])
        .where('connection_id', '=', created.connection.id)
        .orderBy('version')
        .execute();
      expect(versions).toEqual([
        { version: 1, status: 'retiring' },
        { version: 2, status: 'active' },
      ]);
      await db
        .updateTable('connection_credentials')
        .set({ retire_at: new Date(Date.now() - 1000) })
        .where('connection_id', '=', created.connection.id)
        .where('status', '=', 'retiring')
        .execute();
      await api.app.get(ConnectionsMaintenance).run();
      const left = await db
        .selectFrom('connection_credentials')
        .select('version')
        .where('connection_id', '=', created.connection.id)
        .execute();
      expect(left).toEqual([{ version: 2 }]);
    } finally {
      await db.destroy();
    }
  });

  it('checks a PostgreSQL database with the given credentials', async () => {
    const url = new URL(infra().env.DATABASE_URL as string);
    const created = (
      await api
        .post(
          base(),
          {
            providerKey: 'postgres',
            fields: {
              host: url.hostname,
              port: url.port || '5432',
              database: url.pathname.slice(1),
              username: url.username,
              password: decodeURIComponent(url.password),
              ssl: 'disable',
            },
          },
          owner.accessToken,
        )
        .expect(201)
    ).body as WithCheck;
    expect(created.check).toMatchObject({ status: 'ok' });
  });

  it('generates an SSH key for the project and never returns the private half', async () => {
    const created = (
      await api
        .post(
          base(),
          {
            providerKey: 'ssh_server',
            fields: { host: '127.0.0.1', port: '1', username: 'agent' },
          },
          owner.accessToken,
        )
        .expect(201)
    ).body as WithCheck;
    expect(created.connection.config.public_key).toMatch(/^ssh-ed25519 /);
    expect(created.connection.status).toBe('error');
    expect(JSON.stringify(created)).not.toMatch(/PRIVATE KEY/);
  });

  it('validates fields against the provider', async () => {
    const unknown = await api
      .post(
        base(),
        { providerKey: 'http_api', fields: { url: apiUrl, token: 'x'.repeat(20), extra: '1' } },
        owner.accessToken,
      )
      .expect(400);
    expect(unknown.body).toMatchObject({ code: 'CONNECTION_FIELDS_INVALID' });
    await api
      .post(base(), { providerKey: 'telegram_bot', fields: { token: 'not-a-bot-token' } }, owner.accessToken)
      .expect(400);
    await api
      .post(
        base(),
        {
          providerKey: 'yookassa',
          accessLevel: 'read_write',
          fields: { shop_id: '123', secret_key: 'k' },
        },
        owner.accessToken,
      )
      .expect(400);
    const provider = await api
      .post(base(), { providerKey: 'nope', fields: {} }, owner.accessToken)
      .expect(400);
    expect(provider.body).toMatchObject({ code: 'CONNECTION_PROVIDER_UNKNOWN' });
  });

  it('applies the role matrix and hides other accounts', async () => {
    const viewer = await addMember(uniqueEmail('c-viewer'), 'viewer');
    const tech = await addMember(uniqueEmail('c-tech'), 'tech');
    await api.get(base(), viewer.accessToken).expect(403);
    await api.get(`${base()}/summary`, viewer.accessToken).expect(200);
    await api.get(base(), tech.accessToken).expect(200);
    await api.post(`${base()}/disconnect-all`, {}, tech.accessToken).expect(403);

    const stranger = await api.signInWithCode(uniqueEmail('c-stranger'));
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
    const mine = (await api.get(base(), owner.accessToken).expect(200)).body as ConnectionBody[];
    await api
      .post(
        `/v1/accounts/${ownAccount}/projects/${ownProject}/connections/${mine[0]!.id}/check`,
        {},
        stranger.accessToken,
      )
      .expect(404);
  });

  describe('developer links', () => {
    it('lets a developer connect a service without signing in, once', async () => {
      const link = (
        await api.post(`${base()}/links`, { providerKey: 'http_api' }, owner.accessToken).expect(201)
      ).body as { url: string; expiresAt: string };
      const token = link.url.split('/connect/')[1]!;

      const described = await api.get(`/v1/connect/${token}`).expect(200);
      expect(described.body).toMatchObject({ projectName: 'Проект', provider: { key: 'http_api' } });

      const before = api.mail.sent.length;
      const submitted = await api
        .post(`/v1/connect/${token}`, { fields: { url: apiUrl, token: GOOD_TOKEN } })
        .expect(200);
      expect(submitted.body).toMatchObject({ check: { status: 'ok' } });
      // The person who created the link hears about it.
      await api.mailMatch(ownerEmail, /(\/connections)/, before);

      const again = await api
        .post(`/v1/connect/${token}`, { fields: { url: apiUrl, token: GOOD_TOKEN } })
        .expect(409);
      expect(again.body).toMatchObject({ code: 'CONNECTION_LINK_USED' });
      const list = (await api.get(base(), owner.accessToken).expect(200)).body as Array<{
        createdVia: string;
      }>;
      expect(list.some((item) => item.createdVia === 'dev_link')).toBe(true);
    });

    it('refuses expired and unknown links and SSH links', async () => {
      const link = (
        await api.post(`${base()}/links`, { providerKey: 'http_api' }, owner.accessToken).expect(201)
      ).body as { url: string };
      const token = link.url.split('/connect/')[1]!;
      const db = inspectDb();
      try {
        await db
          .updateTable('connection_links')
          .set({ expires_at: new Date(Date.now() - 1000) })
          .where('project_id', '=', projectId)
          .where('used_at', 'is', null)
          .execute();
      } finally {
        await db.destroy();
      }
      const expired = await api.get(`/v1/connect/${token}`).expect(410);
      expect(expired.body).toMatchObject({ code: 'CONNECTION_LINK_EXPIRED' });
      await api.get(`/v1/connect/${'x'.repeat(43)}`).expect(404);
      const ssh = await api
        .post(`${base()}/links`, { providerKey: 'ssh_server' }, owner.accessToken)
        .expect(400);
      expect(ssh.body).toMatchObject({ code: 'CONNECTION_LINK_UNSUPPORTED' });
    });
  });

  it('disconnects one service and then all of them', async () => {
    const created = await connectOwnApi(GOOD_TOKEN);
    await api.delete(`${base()}/${created.connection.id}`, owner.accessToken).expect(204);
    await api.post(`${base()}/${created.connection.id}/check`, {}, owner.accessToken).expect(404);
    const db = inspectDb();
    try {
      const credentials = await db
        .selectFrom('connection_credentials')
        .select('id')
        .where('connection_id', '=', created.connection.id)
        .execute();
      expect(credentials).toHaveLength(0);
    } finally {
      await db.destroy();
    }
    const all = await api.post(`${base()}/disconnect-all`, {}, owner.accessToken).expect(200);
    expect((all.body as { disconnected: number }).disconnected).toBeGreaterThan(0);
    expect((await api.get(base(), owner.accessToken).expect(200)).body).toEqual([]);
    expect((await api.get(`${base()}/summary`, owner.accessToken).expect(200)).body).toMatchObject({
      coveragePct: 0,
    });
  });

  it('refuses private hosts unless allowed', async () => {
    await expect(assertPublicHost('127.0.0.1', false)).rejects.toMatchObject({
      reason: 'PRIVATE_HOST',
    });
    await expect(assertPublicHost('10.1.2.3', false)).rejects.toMatchObject({
      reason: 'PRIVATE_HOST',
    });
    await expect(assertPublicHost('[::1]', false)).rejects.toMatchObject({ reason: 'PRIVATE_HOST' });
    await expect(assertPublicHost('127.0.0.1', true)).resolves.toBeUndefined();
  });
});
