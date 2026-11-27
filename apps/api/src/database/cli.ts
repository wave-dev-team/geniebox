import { loadDbToolingEnv } from '../config/env.js';
import { bootstrapDatabase } from './bootstrap.js';
import { createKysely } from './create-kysely.js';
import { createMigrator, migrateToLatest } from './migrator.js';

const USAGE = 'Usage: db <bootstrap|migrate|rollback|status>';

async function main(command: string | undefined): Promise<void> {
  const env = loadDbToolingEnv();

  if (command === 'bootstrap') {
    if (!env.DATABASE_ADMIN_URL) {
      throw new Error('DATABASE_ADMIN_URL is required for bootstrap');
    }
    await bootstrapDatabase({
      adminUrl: env.DATABASE_ADMIN_URL,
      ownerUrl: env.DATABASE_OWNER_URL,
      appUrl: env.DATABASE_URL,
      systemUrl: env.DATABASE_SYSTEM_URL,
    });
    console.log('Bootstrap completed');
    return;
  }

  const db = createKysely<unknown>({
    connectionString: env.DATABASE_OWNER_URL,
    max: 1,
    applicationName: 'geniebox:migrator',
  });
  try {
    switch (command) {
      case 'migrate': {
        const { results } = await migrateToLatest(db);
        for (const r of results ?? []) console.log(`${r.status}: ${r.migrationName}`);
        if (!results?.length) console.log('No pending migrations');
        break;
      }
      case 'rollback': {
        const { error, results } = await createMigrator(db).migrateDown();
        for (const r of results ?? []) console.log(`${r.status}: ${r.migrationName} (down)`);
        if (error) throw error instanceof Error ? error : new Error('Rollback failed', { cause: error });
        break;
      }
      case 'status': {
        for (const m of await createMigrator(db).getMigrations()) {
          console.log(`${m.executedAt ? m.executedAt.toISOString() : 'pending'.padEnd(24)}  ${m.name}`);
        }
        break;
      }
      default:
        throw new Error(USAGE);
    }
  } finally {
    await db.destroy();
  }
}

main(process.argv[2]).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
