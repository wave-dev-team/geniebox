export const authErrorStatuses = {
  EMAIL_IN_USE: 409,
  INVALID_CREDENTIALS: 401,
  INVALID_EMAIL_CODE: 400,
  EMAIL_NOT_VERIFIED: 403,
  SESSION_EXPIRED: 401,
  REFRESH_CONCURRENT: 409,
  CROSS_ORIGIN_REQUEST: 403,
  PASSWORD_CHANGED: 409,
} as const;

export class AuthError extends Error {
  constructor(readonly code: keyof typeof authErrorStatuses) {
    super(code);
  }
}
