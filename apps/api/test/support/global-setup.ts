import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

import { bootstrapDatabase } from '../../src/database/bootstrap.js';
import { createKysely } from '../../src/database/create-kysely.js';
import { migrateToLatest } from '../../src/database/migrator.js';
import { INFRA_FILE, type TestInfra } from './infra-file.js';

declare global {
  var __GENIEBOX_CONTAINERS__: StartedTestContainer[] | undefined;
}

function roleUrl(adminUrl: string, role: string, password: string, database: string): string {
  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * TEST_DATABASE_ADMIN_URL / TEST_REDIS_URL (CI services, local servers) win; otherwise
 * containers are started. Each run gets a fresh database, migrated by the real Migrator.
 */
export default async function globalSetup(): Promise<void> {
  const containers: StartedTestContainer[] = [];

  let adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (!adminUrl) {
    const pg = await new PostgreSqlContainer('postgres:17-alpine').start();
    containers.push(pg);
    adminUrl = pg.getConnectionUri();
  }

  let redisUrl = process.env.TEST_REDIS_URL;
  if (!redisUrl) {
    const redis = await new GenericContainer('redis:7.4-alpine').withExposedPorts(6379).start();
    containers.push(redis);
    redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  }

  const database = `geniebox_test_${Date.now()}`;
  const ownerUrl = roleUrl(adminUrl, 'geniebox_owner', 'owner_test', database);
  const appUrl = roleUrl(adminUrl, 'geniebox_app', 'app_test', database);
  const systemUrl = roleUrl(adminUrl, 'geniebox_system', 'system_test', database);

  await bootstrapDatabase({ adminUrl, ownerUrl, appUrl, systemUrl });
  const owner = createKysely<unknown>({
    connectionString: ownerUrl,
    max: 1,
    applicationName: 'e2e',
  });
  try {
    await migrateToLatest(owner);
  } finally {
    await owner.destroy();
  }

  // Connection secrets KEK for the run.
  const keyDir = mkdtempSync(join(tmpdir(), 'geniebox-kek-'));
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyFile = join(keyDir, 'kek.pub.pem');
  const privateKeyFile = join(keyDir, 'kek.key.pem');
  writeFileSync(publicKeyFile, pair.publicKey.export({ type: 'spki', format: 'pem' }));
  writeFileSync(privateKeyFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));

  const infra: TestInfra = {
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: appUrl,
      DATABASE_SYSTEM_URL: systemUrl,
      REDIS_STATE_URL: `${redisUrl.replace(/\/\d*$/, '')}/14`,
      REDIS_CACHE_URL: `${redisUrl.replace(/\/\d*$/, '')}/15`,
      OUTBOX_POLL_INTERVAL_MS: '50',
      JWT_ACCESS_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
      MAIL_TRANSPORT: 'memory',
      AUTH_GOOGLE_CLIENT_IDS: 'e2e-google-client',
      AUTH_APPLE_CLIENT_IDS: 'e2e.apple.service',
      THROTTLE_LIMIT: '10000',
      AUTH_THROTTLE_LIMIT: '10000',
      SCHEDULED_TASKS_SWEEP_INTERVAL_MS: '3600000',
      SECRETS_PUBLIC_KEY_FILE: publicKeyFile,
      SECRETS_PRIVATE_KEY_FILES: privateKeyFile,
      // Checks in tests talk to local stand-ins and the test database.
      CONNECTIONS_ALLOW_PRIVATE_HOSTS: 'true',
      CONNECTION_CHECK_TIMEOUT_MS: '3000',
      // The bot runs on the in-memory (Redis) gateway; tests talk to it via the dev endpoints.
    },
    ownerUrl,
    adminUrl,
    database,
    containerIds: containers.map((c) => c.getId()),
  };
  writeFileSync(INFRA_FILE, JSON.stringify(infra));
  globalThis.__GENIEBOX_CONTAINERS__ = containers;
  console.log(`\ne2e database: ${database}`);
}
