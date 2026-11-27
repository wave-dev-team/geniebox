/** Kysely passes jsonb as text; reading returns parsed values typed as Json. */
export const json = (value: unknown): string => JSON.stringify(value);
export const parsed = <T>(value: unknown, fallback: T): T => (value ?? fallback) as T;
