import { type HealthResponse, healthResponseSchema } from '@workspace/types';

export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`API returned HTTP ${status}`);
  }
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/health', { signal, cache: 'no-store' });

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  return healthResponseSchema.parse(await response.json());
}
