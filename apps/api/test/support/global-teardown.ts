import { readFileSync, rmSync } from 'node:fs';

import { Client, escapeIdentifier } from 'pg';

import { INFRA_FILE, type TestInfra } from './infra-file.js';

export default async function globalTeardown(): Promise<void> {
  const infra = JSON.parse(readFileSync(INFRA_FILE, 'utf8')) as TestInfra;
  const containers = globalThis.__GENIEBOX_CONTAINERS__ ?? [];
  if (containers.length === 0 || process.env.TEST_DATABASE_ADMIN_URL) {
    const admin = new Client({ connectionString: infra.adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(infra.database)} WITH (FORCE)`);
    await admin.end();
  }
  await Promise.all(containers.map((container) => container.stop()));
  rmSync(INFRA_FILE, { force: true });
}
