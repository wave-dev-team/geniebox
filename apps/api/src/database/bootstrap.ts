import { Client, escapeIdentifier, escapeLiteral } from 'pg';

import { DB_ROLES } from './roles.js';

export interface BootstrapOptions {
  /** Superuser connection (any database on the cluster). */
  adminUrl: string;
  ownerUrl: string;
  appUrl: string;
  systemUrl: string;
}

interface RoleCredentials {
  name: string;
  password: string;
}

function credentials(url: string, expectedRole: string): RoleCredentials & { database: string } {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.username);
  if (name !== expectedRole) {
    throw new Error(`Connection URL must use role "${expectedRole}", got "${name}"`);
  }
  if (!parsed.password) {
    throw new Error(`Connection URL for role "${expectedRole}" must contain a password`);
  }
  return {
    name,
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)),
  };
}

async function upsertRole(admin: Client, role: RoleCredentials, attributes: string): Promise<void> {
  const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role.name]);
  const verb = exists.rowCount ? 'ALTER' : 'CREATE';
  await admin.query(
    `${verb} ROLE ${escapeIdentifier(role.name)} WITH LOGIN ${attributes} PASSWORD ${escapeLiteral(role.password)}`,
  );
}

/**
 * Idempotent one-time setup that needs a superuser: roles, database, schema ownership,
 * per-role limits. Safe to re-run; also syncs passwords from the URLs.
 */
export async function bootstrapDatabase(options: BootstrapOptions): Promise<void> {
  const owner = credentials(options.ownerUrl, DB_ROLES.owner);
  const app = credentials(options.appUrl, DB_ROLES.app);
  const system = credentials(options.systemUrl, DB_ROLES.system);
  const database = owner.database;
  if (app.database !== database || system.database !== database) {
    throw new Error('All role URLs must point to the same database');
  }

  const admin = new Client({ connectionString: options.adminUrl });
  await admin.connect();
  try {
    await upsertRole(admin, owner, 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS');
    await upsertRole(admin, app, 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS');
    await upsertRole(admin, system, 'NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS');

    const dbExists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (!dbExists.rowCount) {
      await admin.query(
        `CREATE DATABASE ${escapeIdentifier(database)} OWNER ${escapeIdentifier(owner.name)} ENCODING 'UTF8' TEMPLATE template0`,
      );
    }
  } finally {
    await admin.end();
  }

  const adminUrl = new URL(options.adminUrl);
  adminUrl.pathname = `/${encodeURIComponent(database)}`;
  const target = new Client({ connectionString: adminUrl.toString() });
  await target.connect();
  try {
    const db = escapeIdentifier(database);
    const ownerId = escapeIdentifier(owner.name);
    const appId = escapeIdentifier(app.name);
    const systemId = escapeIdentifier(system.name);
    await target.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
    await target.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${ownerId}, ${appId}, ${systemId}`);
    await target.query(`ALTER SCHEMA public OWNER TO ${ownerId}`);
    await target.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC`);
    // vector is not a trusted extension: only a superuser can install it. Migrations then
    // see it already present and never need these privileges.
    await target.query('CREATE EXTENSION IF NOT EXISTS vector');
    await target.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await target.query(`GRANT USAGE ON SCHEMA public TO ${appId}, ${systemId}`);
    // Request-path limits: a runaway query or a forgotten transaction must not hold the DB.
    await target.query(`ALTER ROLE ${appId} IN DATABASE ${db} SET statement_timeout = '15s'`);
    await target.query(
      `ALTER ROLE ${appId} IN DATABASE ${db} SET idle_in_transaction_session_timeout = '30s'`,
    );
    await target.query(`ALTER ROLE ${appId} IN DATABASE ${db} SET lock_timeout = '5s'`);
    await target.query(`ALTER ROLE ${systemId} IN DATABASE ${db} SET statement_timeout = '60s'`);
    await target.query(
      `ALTER ROLE ${systemId} IN DATABASE ${db} SET idle_in_transaction_session_timeout = '60s'`,
    );
  } finally {
    await target.end();
  }
}
