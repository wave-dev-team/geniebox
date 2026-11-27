import { HttpStatus } from '@nestjs/common';

import { ErrorCode } from './error-codes.js';

export interface DomainExceptionOptions {
  /** i18n key for the user-facing message; defaults to `errors.<CODE>`. */
  messageKey?: string;
  messageArgs?: Record<string, unknown>;
  details?: unknown;
  cause?: unknown;
}

/**
 * Base class for all business exceptions. HTTP mapping happens only in the global filter;
 * services throw these without knowing about transport.
 */
export class DomainException extends Error {
  readonly messageKey: string;
  readonly messageArgs?: Record<string, unknown>;
  readonly details?: unknown;

  constructor(
    readonly code: string,
    readonly status: HttpStatus,
    options: DomainExceptionOptions = {},
  ) {
    super(code, { cause: options.cause });
    this.name = new.target.name;
    this.messageKey = options.messageKey ?? `errors.${code}`;
    this.messageArgs = options.messageArgs;
    this.details = options.details;
  }
}

export class EntityNotFoundException extends DomainException {
  constructor(code: string = ErrorCode.NOT_FOUND, options?: DomainExceptionOptions) {
    super(code, HttpStatus.NOT_FOUND, options);
  }
}

export class ConflictException extends DomainException {
  constructor(code: string = ErrorCode.CONFLICT, options?: DomainExceptionOptions) {
    super(code, HttpStatus.CONFLICT, options);
  }
}

export class ForbiddenActionException extends DomainException {
  constructor(code: string = ErrorCode.FORBIDDEN, options?: DomainExceptionOptions) {
    super(code, HttpStatus.FORBIDDEN, options);
  }
}

export class UnauthorizedException extends DomainException {
  constructor(code: string = ErrorCode.UNAUTHORIZED, options?: DomainExceptionOptions) {
    super(code, HttpStatus.UNAUTHORIZED, options);
  }
}

export interface ValidationIssue {
  field: string;
  constraints: string[];
}

export class ValidationException extends DomainException {
  constructor(issues: ValidationIssue[]) {
    super(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, { details: issues });
  }
}

/** Programming error: account-scoped code ran without an account in context. Always a 500. */
export class AccountContextMissingException extends DomainException {
  constructor() {
    super(ErrorCode.ACCOUNT_CONTEXT_MISSING, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

/** Programming error: user-scoped code ran without a signed-in user in context. Always a 500. */
export class UserContextMissingException extends DomainException {
  constructor() {
    super(ErrorCode.USER_CONTEXT_MISSING, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
