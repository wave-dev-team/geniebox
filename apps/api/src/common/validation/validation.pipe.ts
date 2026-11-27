import { type ValidationError, ValidationPipe } from '@nestjs/common';

import { ValidationException, type ValidationIssue } from '../exceptions/index.js';

function flatten(errors: ValidationError[], parent = ''): ValidationIssue[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own: ValidationIssue[] = error.constraints
      ? [{ field, constraints: Object.keys(error.constraints) }]
      : [];
    return [...own, ...flatten(error.children ?? [], field)];
  });
}

/** Global pipe: strips and rejects unknown fields, aggregates issues into `details`. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    // Constraint names (not messages) are exposed so clients can localize them.
    exceptionFactory: (errors) => new ValidationException(flatten(errors)),
  });
}
