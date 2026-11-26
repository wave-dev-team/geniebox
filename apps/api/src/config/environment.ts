import { z } from 'zod';

export const appEnvironment = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().max(65535).default(8000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
});

export const migrationEnvironment = z.object({
  DB_MIGRATION_URL: z.string().url(),
});

export const bootstrapEnvironment = migrationEnvironment.extend({
  DB_APP_PASSWORD: z.string().min(24),
});
