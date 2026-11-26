import { type HealthResponse, healthResponseSchema } from '@workspace/types';

import { request } from './request.js';

export { authApi, profileApi } from './identity.js';
export { ApiError } from './request.js';

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return healthResponseSchema.parse(await (await request('/health', { signal })).json());
}
