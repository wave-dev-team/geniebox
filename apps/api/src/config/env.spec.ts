import { validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://geniebox_app:x@localhost:5432/geniebox',
  DATABASE_SYSTEM_URL: 'postgres://geniebox_system:x@localhost:5432/geniebox',
  REDIS_STATE_URL: 'redis://localhost:6379/0',
  REDIS_CACHE_URL: 'redis://localhost:6380/0',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults and parses lists', () => {
    const env = validateEnv({ ...base, CORS_ORIGINS: 'https://a.ru, https://b.ru,,' });
    expect(env.PUBLIC_PORT).toBe(3000);
    expect(env.INTERNAL_HOST).toBe('127.0.0.1');
    expect(env.CORS_ORIGINS).toEqual(['https://a.ru', 'https://b.ru']);
  });

  it('disables swagger in production unless explicitly enabled', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      MAIL_TRANSPORT: 'smtp',
      SMTP_URL: 'smtp://mx:25',
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test-0123456789abcdefghij',
    };
    expect(validateEnv(prod).SWAGGER_ENABLED).toBe(false);
    expect(validateEnv({ ...base, NODE_ENV: 'development' }).SWAGGER_ENABLED).toBe(true);
    expect(validateEnv({ ...prod, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(true);
  });

  it('refuses non-SMTP mail in production: log transport would leak codes into logs', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/MAIL_TRANSPORT/);
    expect(() => validateEnv({ ...base, MAIL_TRANSPORT: 'smtp' })).toThrow(/SMTP_URL/);
  });

  it('needs a real LLM provider with its key in production', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      MAIL_TRANSPORT: 'smtp',
      SMTP_URL: 'smtp://mx:25',
    };
    expect(() => validateEnv(prod)).toThrow(/LLM_PROVIDER/);
    expect(() => validateEnv({ ...prod, LLM_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
  });

  it('rejects missing or malformed connection strings', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    const withoutCache = { ...base, REDIS_CACHE_URL: undefined };
    expect(() => validateEnv(withoutCache)).toThrow(/REDIS_CACHE_URL/);
  });
});
