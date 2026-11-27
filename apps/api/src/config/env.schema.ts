import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
const commaList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
const redisUrl = z.url({ protocol: /^rediss?$/ });

export const NODE_ENVS = ['development', 'test', 'production'] as const;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),
    LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    PUBLIC_HOST: z.string().min(1).default('0.0.0.0'),
    PUBLIC_PORT: z.coerce.number().int().positive().default(3000),
    // Internal API must listen on a private interface (WireGuard / docker network) only.
    INTERNAL_HOST: z.string().min(1).default('127.0.0.1'),
    INTERNAL_PORT: z.coerce.number().int().positive().default(3100),

    CORS_ORIGINS: commaList,
    SWAGGER_ENABLED: booleanFromString.optional(),
    // Express "trust proxy" for the public listener (reverse proxy in front). See expressjs docs.
    TRUST_PROXY: z.string().default('loopback'),
    THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),
    // Per-IP limit per minute on credential endpoints (@StrictThrottle).
    AUTH_THROTTLE_LIMIT: z.coerce.number().int().positive().default(10),

    // Application role: no BYPASSRLS, does not own tables.
    DATABASE_URL: postgresUrl,
    // System role: BYPASSRLS, used only by cross-account system jobs.
    DATABASE_SYSTEM_URL: postgresUrl,
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    // Durable Redis (AOF, noeviction): BullMQ, throttling, locks, token state.
    REDIS_STATE_URL: redisUrl,
    // Disposable Redis (allkeys-lru): cache only, may lose data at any time.
    REDIS_CACHE_URL: redisUrl,

    // Base URL of the web app, used in links sent by email (invitations).
    APP_PUBLIC_URL: z.url().default('http://localhost:3001'),

    // HS256 secret for user access tokens; rotate by deploying a new value (signs out everyone).
    JWT_ACCESS_SECRET: z.string().min(32),
    ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(900),
    // Sliding refresh lifetime, extended on every refresh, capped by the absolute max age.
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    REFRESH_TOKEN_MAX_AGE_DAYS: z.coerce.number().int().positive().default(90),
    // OAuth client ids accepted as ID token audience; empty list disables the provider.
    AUTH_GOOGLE_CLIENT_IDS: commaList,
    AUTH_APPLE_CLIENT_IDS: commaList,

    // "log" prints mails (dev only), "memory" keeps them for tests, "smtp" sends via SMTP_URL.
    MAIL_TRANSPORT: z.enum(['log', 'memory', 'smtp']).default('log'),
    SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
    MAIL_FROM: z.string().min(3).default('Geniebox <no-reply@geniebox.local>'),

    MAX_ACCOUNTS_PER_USER: z.coerce.number().int().positive().default(20),
    INVITATION_TTL_DAYS: z.coerce.number().int().positive().default(7),
    MAX_AGENTS_PER_PROJECT: z.coerce.number().int().positive().default(30),
    MAX_PROJECTS_PER_ACCOUNT: z.coerce.number().int().positive().default(10),
    // Soft-deleted projects are purged after this many days.
    PROJECT_PURGE_AFTER_DAYS: z.coerce.number().int().positive().default(30),
    // Connection secrets KEK. Public key: every process; private keys: worker only,
    // comma-separated, newest first (older ones open secrets sealed before a rotation).
    SECRETS_PUBLIC_KEY_FILE: z.string().min(1).default('.secrets/kek.pub.pem'),
    SECRETS_PRIVATE_KEY_FILES: commaList,
    // Lets connection checks reach private/loopback hosts. Never in production.
    CONNECTIONS_ALLOW_PRIVATE_HOSTS: booleanFromString.default(false),
    CONNECTION_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    // Background re-check of every connection older than this.
    CONNECTION_RECHECK_HOURS: z.coerce.number().int().positive().default(6),
    DEV_LINK_TTL_DAYS: z.coerce.number().int().positive().default(7),
    // Where Help-screen requests are sent.
    SUPPORT_EMAIL: z.email().default('support@geniebox.local'),

    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(100),
    SCHEDULED_TASKS_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
    // Agent runtime. `fake` is deterministic and offline: dev and tests.
    LLM_PROVIDER: z.enum(['fake', 'openai']).default('fake'),
    OPENAI_API_KEY: z.string().min(20).optional(),
    OPENAI_BASE_URL: z.url().default('https://api.openai.com/v1'),
    LLM_MODEL: z.string().min(1).default('gpt-4.1-mini'),
    // Catalog agents with the «fast» model purpose; LLM_MODEL when unset.
    LLM_MODEL_FAST: z.string().min(1).optional(),
    // Knowledge base. Uploaded sources live outside the web root and are shared with the worker.
    KNOWLEDGE_BLOB_DIR: z.string().min(1).default('./data/knowledge'),
    KNOWLEDGE_MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(20 * 1024 * 1024),
    // Embeddings: `fake` is deterministic and offline (dev, tests); `none` keeps FTS-only search.
    EMBEDDING_PROVIDER: z.enum(['none', 'fake', 'openai']).default('none'),
    EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
    EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().max(2000).default(1536),
    EMBEDDING_BASE_URL: z.url().default('https://api.openai.com/v1'),
    EMBEDDING_API_KEY: z.string().min(20).optional(),
    // USD per million embedding tokens; the cost is journaled per project.
    EMBEDDING_PRICE_PER_MTOK: z.coerce.number().nonnegative().default(0.02),

    // USD per million tokens of LLM_MODEL; the cost of every call goes to llm_calls.
    LLM_PRICE_IN_PER_MTOK: z.coerce.number().nonnegative().default(0.4),
    LLM_PRICE_OUT_PER_MTOK: z.coerce.number().nonnegative().default(1.6),
    USD_RUB_RATE: z.coerce.number().positive().default(95),
    // Multiplier over the provider price (1.3 = +30%).
    LLM_MARKUP: z.coerce.number().min(1).default(1.3),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    LLM_MAX_TOKENS: z.coerce.number().int().positive().max(32_000).default(2_000),
    // Calls per second to the provider across the worker (rate limiter of the runtime queues).
    LLM_RATE_PER_SEC: z.coerce.number().int().positive().default(5),
    // Tool-calling rounds of one task or one answer before it is stopped.
    AGENT_MAX_STEPS: z.coerce.number().int().positive().max(30).default(8),
    DECISION_TTL_DAYS: z.coerce.number().int().positive().default(14),
    DECISION_COOLDOWN_DAYS: z.coerce.number().int().positive().default(7),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_TRANSPORT === 'smtp' && !env.SMTP_URL) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'required for smtp transport' });
    }
    // "log" would print one-time codes and invitation tokens into production logs.
    if (env.NODE_ENV === 'production' && env.MAIL_TRANSPORT !== 'smtp') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message: 'must be smtp in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.CONNECTIONS_ALLOW_PRIVATE_HOSTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['CONNECTIONS_ALLOW_PRIVATE_HOSTS'],
        message: 'must be false in production',
      });
    }
    if (env.LLM_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['OPENAI_API_KEY'], message: 'required for openai' });
    }
    if (env.EMBEDDING_PROVIDER === 'openai' && !env.EMBEDDING_API_KEY && !env.OPENAI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMBEDDING_API_KEY'],
        message: 'EMBEDDING_API_KEY or OPENAI_API_KEY is required for the openai provider',
      });
    }
    if (env.NODE_ENV === 'production' && env.EMBEDDING_PROVIDER === 'fake') {
      ctx.addIssue({
        code: 'custom',
        path: ['EMBEDDING_PROVIDER'],
        message: 'must not be fake in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.LLM_PROVIDER === 'fake') {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_PROVIDER'],
        message: 'must not be fake in production',
      });
    }
    if (env.REFRESH_TOKEN_MAX_AGE_DAYS < env.REFRESH_TOKEN_TTL_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['REFRESH_TOKEN_MAX_AGE_DAYS'],
        message: 'must be >= REFRESH_TOKEN_TTL_DAYS',
      });
    }
  })
  .transform((env) => ({
    ...env,
    SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production',
  }));

export type Env = z.infer<typeof envSchema>;

/** Env needed only by DB tooling (bootstrap/migrations); never loaded by the running app. */
export const dbToolingEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
  DATABASE_SYSTEM_URL: postgresUrl,
  // Owner role: owns the schema, runs migrations.
  DATABASE_OWNER_URL: postgresUrl,
  // Superuser, required only for one-time role/database bootstrap.
  DATABASE_ADMIN_URL: postgresUrl.optional(),
});

export type DbToolingEnv = z.infer<typeof dbToolingEnvSchema>;
