import { z } from 'zod';

const errorSchema = z.object({ code: z.string(), message: z.string().optional() });

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code?: string,
    public readonly detail?: string,
  ) {
    super(`API returned HTTP ${status}`);
  }
}

export async function request(path: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  headers.set('X-Geniebox-Request', '1');
  if (typeof document !== 'undefined') headers.set('Accept-Language', document.documentElement.lang || 'ru');
  if (options?.body) headers.set('Content-Type', 'application/json');

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    const error = errorSchema.safeParse(await response.json().catch(() => undefined));
    throw new ApiError(response.status, error.data?.code, error.data?.message);
  }
  return response;
}
