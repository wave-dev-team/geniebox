import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';

// bigint (int8) as string: JS numbers lose precision past 2^53.
types.setTypeParser(types.builtins.INT8, (value) => value);
// date as the ISO day string: a Date at local midnight shifts the day in non-UTC time zones.
types.setTypeParser(types.builtins.DATE, (value) => value);

export interface CreateKyselyOptions {
  connectionString: string;
  max?: number;
  applicationName: string;
}

export function createKysely<DB>(options: CreateKyselyOptions): Kysely<DB> {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
