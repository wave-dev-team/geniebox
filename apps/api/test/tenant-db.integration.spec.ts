import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { type Kysely, sql } from 'kysely';
import { Migrator } from 'kysely/migration';

import { ClsService } from 'nestjs-cls';

import { createDb } from '../src/database/create-db.js';
import { migrationProvider } from '../src/database/migrations/index.js';
import { bootstrapRoles } from '../src/database/roles.js';
import { type RequestContext, TenantDb } from '../src/database/tenant-db.js';
import type { DB } from '../src/database/types.js';

const firstTenant = '10000000-0000-4000-8000-000000000001';
const secondTenant = '10000000-0000-4000-8000-000000000002';
const password = 'integration-only-app-password';
const context = new ClsService<RequestContext>(new AsyncLocalStorage<RequestContext>());

let database: StartedPostgreSqlContainer;
let owner: Kysely<DB>;
let runtime: Kysely<DB>;
let tenants: TenantDb;
let migrator: Migrator;

beforeAll(async () => {
  database = await new PostgreSqlContainer('postgres:17-alpine').start();
  owner = createDb(database.getConnectionUri());
  await bootstrapRoles(owner, password);
  migrator = new Migrator({ db: owner, provider: migrationProvider });
  const result = await migrator.migrateToLatest();
  if (result.error) {
    throw result.error;
  }

  const url = new URL(database.getConnectionUri());
  url.username = 'geniebox_app';
  url.password = password;
  runtime = createDb(url.toString());
  tenants = new TenantDb(runtime, context);
}, 120_000);

afterAll(async () => {
  try {
    await tenants?.onApplicationShutdown();
    await owner?.destroy();
  } finally {
    await database?.stop();
  }
});

it('isolates reads and writes between tenants and fails closed without tenant context', async () => {
  const rows = [
    { tenant_id: firstTenant, key: 'checkout', label: 'A' },
    { tenant_id: secondTenant, key: 'checkout', label: 'B' },
  ];

  for (const row of rows) {
    await context.runWith({ tenantId: row.tenant_id }, () =>
      tenants.transaction((tx) => tx.insertInto('metric_definitions').values(row).execute()),
    );
  }

  await context.runWith({ tenantId: firstTenant }, async () => {
    const visible = await tenants.transaction((tx) =>
      tx.selectFrom('metric_definitions').selectAll().execute(),
    );
    expect(visible).toEqual([rows[0]]);
    const updates = await tenants.transaction((tx) =>
      tx
        .updateTable('metric_definitions')
        .set({ label: 'Changed' })
        .where('tenant_id', '=', secondTenant)
        .executeTakeFirst(),
    );
    expect(updates.numUpdatedRows).toBe(0n);
    await expect(
      tenants.transaction((tx) =>
        tx
          .insertInto('metric_definitions')
          .values({ tenant_id: secondTenant, key: 'another', label: 'C' })
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  expect(await runtime.selectFrom('metric_definitions').selectAll().execute()).toEqual([]);
  await expect(tenants.transaction(async () => undefined)).rejects.toThrow();
});

it('keeps generated types synchronized with the migrated schema', async () => {
  await promisify(execFile)('pnpm', ['run', 'db:types', '--verify'], {
    env: { ...process.env, DB_MIGRATION_URL: database.getConnectionUri() },
    timeout: 15_000,
  });
}, 20_000);

it('rolls back and reapplies the schema with the migration owner', async () => {
  expect((await migrator.migrateDown()).error).toBeUndefined();
  const state = await sql<{
    table_name: string | null;
  }>`select to_regclass('public.metric_definitions') as table_name`.execute(owner);
  expect(state.rows[0]?.table_name).toBeNull();
  expect((await migrator.migrateToLatest()).error).toBeUndefined();
});
