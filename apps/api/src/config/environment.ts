import { z } from 'zod';

export const appEnvironment = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().max(65535).default(8000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  AUTH_IDENTITY_SECRET: z.string().min(32),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  SMTP_URL: z.url({ protocol: /^smtps?$/ }),
  AUTH_MAIL_FROM: z.email(),
  AUTH_COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
});

export const migrationEnvironment = z.object({
  DB_MIGRATION_URL: z.string().url(),
});

export const bootstrapEnvironment = migrationEnvironment.extend({
  DB_APP_PASSWORD: z.string().min(24),
});
