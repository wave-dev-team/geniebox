import { HttpStatus } from '@nestjs/common';

import { DomainException, type DomainExceptionOptions } from '../../common/exceptions/index.js';

export const METRICS_ERRORS = {
  METRIC_NOT_FOUND: 'METRIC_NOT_FOUND',
  METRIC_KEY_TAKEN: 'METRIC_KEY_TAKEN',
  METRIC_LIMIT_REACHED: 'METRIC_LIMIT_REACHED',
  METRIC_PINNED_LIMIT: 'METRIC_PINNED_LIMIT',
  METRIC_SOURCE_INVALID: 'METRIC_SOURCE_INVALID',
  INSIGHT_NOT_FOUND: 'INSIGHT_NOT_FOUND',
} as const;

type MetricsErrorCode = (typeof METRICS_ERRORS)[keyof typeof METRICS_ERRORS];

const STATUS: Record<MetricsErrorCode, HttpStatus> = {
  METRIC_NOT_FOUND: HttpStatus.NOT_FOUND,
  METRIC_KEY_TAKEN: HttpStatus.CONFLICT,
  METRIC_LIMIT_REACHED: HttpStatus.CONFLICT,
  METRIC_PINNED_LIMIT: HttpStatus.CONFLICT,
  // Source kind, connection and query do not fit together.
  METRIC_SOURCE_INVALID: HttpStatus.BAD_REQUEST,
  INSIGHT_NOT_FOUND: HttpStatus.NOT_FOUND,
};

export class MetricsException extends DomainException {
  constructor(code: MetricsErrorCode, options?: DomainExceptionOptions) {
    super(code, STATUS[code], options);
  }
}
