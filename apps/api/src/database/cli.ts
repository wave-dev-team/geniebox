import { Migrator } from 'kysely/migration';
import { z } from 'zod';

import { bootstrapEnvironment, migrationEnvironment } from '../config/environment.js';
import { createDb } from './create-db.js';
import { migrationProvider } from './migrations/index.js';
import { bootstrapRoles } from './roles.js';

const command = z.enum(['bootstrap', 'migrate', 'rollback', 'status']).parse(process.argv[2]);
const environment = migrationEnvironment.parse(process.env);
const db = createDb(environment.DB_MIGRATION_URL);

try {
  const migrator = new Migrator({ db, provider: migrationProvider });

  switch (command) {
    case 'bootstrap': {
      const { DB_APP_PASSWORD } = bootstrapEnvironment.parse(process.env);
      await bootstrapRoles(db, DB_APP_PASSWORD);
      break;
    }
    case 'migrate':
    case 'rollback': {
      const result = await (command === 'migrate' ? migrator.migrateToLatest() : migrator.migrateDown());
      process.stdout.write(JSON.stringify(result.results ?? []) + '\n');

      if (result.error) {
        throw result.error;
      }
      break;
    }
    case 'status':
      process.stdout.write(JSON.stringify(await migrator.getMigrations(), null, 2) + '\n');
      break;
  }
} finally {
  await db.destroy();
}
