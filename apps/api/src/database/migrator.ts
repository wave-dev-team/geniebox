import type { Kysely } from 'kysely';
import { type MigrationResultSet, Migrator } from 'kysely/migration';

import { migrations } from './migrations/index.js';

export function createMigrator(db: Kysely<unknown>): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(migrations) },
  });
}

export class MigrationFailedError extends Error {
  constructor(
    readonly resultSet: MigrationResultSet,
    cause: unknown,
  ) {
    super('Migration failed', { cause });
  }
}

/** Throws if any migration fails; Kysely rolls back the failed one. */
export async function migrateToLatest(db: Kysely<unknown>): Promise<MigrationResultSet> {
  const resultSet = await createMigrator(db).migrateToLatest();
  if (resultSet.error) {
    throw new MigrationFailedError(resultSet, resultSet.error);
  }
  return resultSet;
}
