/** Thrown from `down` of a migration that cannot be rolled back without data loss. */
export class IrreversibleMigrationError extends Error {
  constructor(migration: string, reason: string) {
    super(`Migration ${migration} is irreversible: ${reason}`);
  }
}
