import { HttpStatus } from '@nestjs/common';

import { DomainException, type DomainExceptionOptions } from '../../common/exceptions/index.js';

export const PROJECT_ERRORS = {
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  PROJECT_SLUG_TAKEN: 'PROJECT_SLUG_TAKEN',
  PROJECT_LIMIT_REACHED: 'PROJECT_LIMIT_REACHED',
  PROJECT_NAME_MISMATCH: 'PROJECT_NAME_MISMATCH',
} as const;

type ProjectErrorCode = (typeof PROJECT_ERRORS)[keyof typeof PROJECT_ERRORS];

const STATUS: Record<ProjectErrorCode, HttpStatus> = {
  // Unknown, deleted and other accounts' projects look the same.
  PROJECT_NOT_FOUND: HttpStatus.NOT_FOUND,
  PROJECT_SLUG_TAKEN: HttpStatus.CONFLICT,
  PROJECT_LIMIT_REACHED: HttpStatus.CONFLICT,
  PROJECT_NAME_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
};

export class ProjectException extends DomainException {
  constructor(code: ProjectErrorCode, options?: DomainExceptionOptions) {
    super(code, STATUS[code], options);
  }
}
