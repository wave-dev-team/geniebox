import { HttpStatus } from '@nestjs/common';

import { DomainException, type DomainExceptionOptions } from '../../common/exceptions/index.js';

export const ACCOUNT_ERRORS = {
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  ACCOUNT_ROLE_REQUIRED: 'ACCOUNT_ROLE_REQUIRED',
  ACCOUNT_SLUG_TAKEN: 'ACCOUNT_SLUG_TAKEN',
  ACCOUNT_LIMIT_REACHED: 'ACCOUNT_LIMIT_REACHED',
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
  OWNER_ROLE_IMMUTABLE: 'OWNER_ROLE_IMMUTABLE',
  OWNER_REQUIRED: 'OWNER_REQUIRED',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  INVITATION_NOT_FOUND: 'INVITATION_NOT_FOUND',
  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  INVITATION_EMAIL_MISMATCH: 'INVITATION_EMAIL_MISMATCH',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  ACCOUNT_BLOCKED: 'ACCOUNT_BLOCKED',
} as const;

type AccountErrorCode = (typeof ACCOUNT_ERRORS)[keyof typeof ACCOUNT_ERRORS];

const STATUS: Record<AccountErrorCode, HttpStatus> = {
  // Unknown and inaccessible accounts look the same: no existence oracle.
  ACCOUNT_NOT_FOUND: HttpStatus.NOT_FOUND,
  ACCOUNT_ROLE_REQUIRED: HttpStatus.FORBIDDEN,
  ACCOUNT_SLUG_TAKEN: HttpStatus.CONFLICT,
  ACCOUNT_LIMIT_REACHED: HttpStatus.CONFLICT,
  MEMBER_NOT_FOUND: HttpStatus.NOT_FOUND,
  OWNER_ROLE_IMMUTABLE: HttpStatus.CONFLICT,
  OWNER_REQUIRED: HttpStatus.FORBIDDEN,
  ALREADY_MEMBER: HttpStatus.CONFLICT,
  INVITATION_NOT_FOUND: HttpStatus.NOT_FOUND,
  INVITATION_EXPIRED: HttpStatus.GONE,
  INVITATION_EMAIL_MISMATCH: HttpStatus.FORBIDDEN,
  EMAIL_NOT_VERIFIED: HttpStatus.FORBIDDEN,
  ACCOUNT_BLOCKED: HttpStatus.FORBIDDEN,
};

export class AccountException extends DomainException {
  constructor(code: AccountErrorCode, options?: DomainExceptionOptions) {
    super(code, STATUS[code], options);
  }
}
