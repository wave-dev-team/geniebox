import { HttpStatus } from '@nestjs/common';

import { DomainException, type DomainExceptionOptions } from '../../common/exceptions/index.js';

export const CONNECTION_ERRORS = {
  CONNECTION_NOT_FOUND: 'CONNECTION_NOT_FOUND',
  CONNECTION_PROVIDER_UNKNOWN: 'CONNECTION_PROVIDER_UNKNOWN',
  CONNECTION_FIELDS_INVALID: 'CONNECTION_FIELDS_INVALID',
  CONNECTION_ACCESS_UNSUPPORTED: 'CONNECTION_ACCESS_UNSUPPORTED',
  CONNECTION_CHECK_UNAVAILABLE: 'CONNECTION_CHECK_UNAVAILABLE',
  CONNECTION_LINK_NOT_FOUND: 'CONNECTION_LINK_NOT_FOUND',
  CONNECTION_LINK_EXPIRED: 'CONNECTION_LINK_EXPIRED',
  CONNECTION_LINK_USED: 'CONNECTION_LINK_USED',
  CONNECTION_LINK_UNSUPPORTED: 'CONNECTION_LINK_UNSUPPORTED',
} as const;

type ConnectionErrorCode = (typeof CONNECTION_ERRORS)[keyof typeof CONNECTION_ERRORS];

const STATUS: Record<ConnectionErrorCode, HttpStatus> = {
  CONNECTION_NOT_FOUND: HttpStatus.NOT_FOUND,
  CONNECTION_PROVIDER_UNKNOWN: HttpStatus.BAD_REQUEST,
  CONNECTION_FIELDS_INVALID: HttpStatus.BAD_REQUEST,
  CONNECTION_ACCESS_UNSUPPORTED: HttpStatus.BAD_REQUEST,
  // The worker did not answer in time; the check keeps running and updates the status later.
  CONNECTION_CHECK_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  CONNECTION_LINK_NOT_FOUND: HttpStatus.NOT_FOUND,
  CONNECTION_LINK_EXPIRED: HttpStatus.GONE,
  CONNECTION_LINK_USED: HttpStatus.CONFLICT,
  // SSH keys are generated for the project and installed by hand; no link is needed.
  CONNECTION_LINK_UNSUPPORTED: HttpStatus.BAD_REQUEST,
};

export class ConnectionException extends DomainException {
  constructor(code: ConnectionErrorCode, options?: DomainExceptionOptions) {
    super(code, STATUS[code], options);
  }
}
