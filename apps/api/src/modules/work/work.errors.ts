import { HttpStatus } from '@nestjs/common';

import { DomainException, type DomainExceptionOptions } from '../../common/exceptions/index.js';

export const WORK_ERRORS = {
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  TASK_STATE_INVALID: 'TASK_STATE_INVALID',
  ROUTINE_NOT_FOUND: 'ROUTINE_NOT_FOUND',
  DECISION_NOT_FOUND: 'DECISION_NOT_FOUND',
  DECISION_ALREADY_DECIDED: 'DECISION_ALREADY_DECIDED',
  DECISION_TERM_INVALID: 'DECISION_TERM_INVALID',
  CONVERSATION_NOT_FOUND: 'CONVERSATION_NOT_FOUND',
  CONVERSATION_BUSY: 'CONVERSATION_BUSY',
  WORK_AGENT_INVALID: 'WORK_AGENT_INVALID',
} as const;

type WorkErrorCode = (typeof WORK_ERRORS)[keyof typeof WORK_ERRORS];

const STATUS: Record<WorkErrorCode, HttpStatus> = {
  TASK_NOT_FOUND: HttpStatus.NOT_FOUND,
  TASK_STATE_INVALID: HttpStatus.CONFLICT,
  ROUTINE_NOT_FOUND: HttpStatus.NOT_FOUND,
  DECISION_NOT_FOUND: HttpStatus.NOT_FOUND,
  DECISION_ALREADY_DECIDED: HttpStatus.CONFLICT,
  DECISION_TERM_INVALID: HttpStatus.BAD_REQUEST,
  CONVERSATION_NOT_FOUND: HttpStatus.NOT_FOUND,
  // One answer at a time: the previous reply is still being written.
  CONVERSATION_BUSY: HttpStatus.CONFLICT,
  WORK_AGENT_INVALID: HttpStatus.BAD_REQUEST,
};

export class WorkException extends DomainException {
  constructor(code: WorkErrorCode, options?: DomainExceptionOptions) {
    super(code, STATUS[code], options);
  }
}
