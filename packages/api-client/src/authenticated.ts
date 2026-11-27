import { ApiError, request } from './request.js';

let refreshInFlight: Promise<void> | undefined;

function refreshSession() {
  const rotate = () => request('/v1/auth/refresh', { method: 'POST' });
  refreshInFlight ??= (navigator.locks ? navigator.locks.request('geniebox-refresh', rotate) : rotate())
    .then(() => undefined)
    .finally(() => {
      refreshInFlight = undefined;
    });
  return refreshInFlight;
}

export async function authenticated(path: string, options?: RequestInit): Promise<Response> {
  try {
    return await request(path, options);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    try {
      await refreshSession();
    } catch (refreshError) {
      if (!(refreshError instanceof ApiError) || refreshError.code !== 'REFRESH_IN_PROGRESS')
        throw refreshError;
      for (const delay of [100, 250, 500]) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        try {
          return await request(path, options);
        } catch (retryError) {
          if (!(retryError instanceof ApiError) || retryError.status !== 401) throw retryError;
        }
      }
      throw refreshError;
    }
    return request(path, options);
  }
}
