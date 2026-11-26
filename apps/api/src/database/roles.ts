/**
 * Database roles. Names are fixed: migrations grant privileges to them explicitly.
 * - owner:  owns schema and tables, runs migrations; never used by the running app.
 * - app:    request-path role, no BYPASSRLS; sees only the current account's rows.
 * - system: cross-account system jobs (outbox relay, sweepers, catalog); BYPASSRLS, narrow
 *   grants.
 */
export const DB_ROLES = {
  owner: 'geniebox_owner',
  app: 'geniebox_app',
  system: 'geniebox_system',
} as const;
