import { z } from 'zod';

export const appEnvironment = z
  .object({
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
    LLM_BASE_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.url({ protocol: /^https?$/ }).optional(),
    ),
    LLM_MODEL: z.string().default(''),
    LLM_API_KEY: z.string().optional(),
    LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(90000),
    LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(4096).default(768),
    LLM_DAILY_CALL_LIMIT: z.coerce.number().int().positive().default(100),
    LLM_CALLS_PER_MINUTE: z.coerce.number().int().positive().default(30),
    LLM_INPUT_USD_PER_MTOK: z.coerce.number().min(0).default(0),
    LLM_OUTPUT_USD_PER_MTOK: z.coerce.number().min(0).default(0),
  })
  .refine((env) => !env.LLM_BASE_URL || !!env.LLM_MODEL.trim(), {
    path: ['LLM_MODEL'],
    message: 'Required when LLM_BASE_URL is set',
  });

export type AppEnvironment = z.infer<typeof appEnvironment>;

export const migrationEnvironment = z.object({
  DB_MIGRATION_URL: z.string().url(),
});

export const bootstrapEnvironment = migrationEnvironment.extend({
  DB_APP_PASSWORD: z.string().min(24),
});
