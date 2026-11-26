import { type z } from 'zod';

import { type DbToolingEnv, dbToolingEnvSchema, type Env, envSchema } from './env.schema.js';

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

/** Parses and validates process env. The only place in the app allowed to read process.env. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment: ${formatIssues(result.error)}`);
  }
  return result.data;
}

export function loadDbToolingEnv(): DbToolingEnv {
  const result = dbToolingEnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid environment: ${formatIssues(result.error)}`);
  }
  return result.data;
}
