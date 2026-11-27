import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import type { TaskError } from '../work/work.constants.js';

export type RuntimeErrorCode =
  'BUDGET' | 'AGENT_PAUSED' | 'AGENT_GONE' | 'STEP_LIMIT' | 'LLM_UNAVAILABLE' | 'INTERNAL' | 'ACTION_FAILED';

/** Texts the platform writes on behalf of agents (steps, statuses, errors). */
@Injectable()
export class RuntimeTexts {
  constructor(private readonly i18n: I18nService) {}

  t(key: string, lang: string, args?: Record<string, unknown>): string {
    return this.i18n.t(`runtime.${key}`, { lang, args });
  }

  error(code: RuntimeErrorCode, lang: string, args?: Record<string, unknown>): TaskError {
    return {
      code,
      what: this.t(`errors.${code}.what`, lang, args),
      fix: this.t(`errors.${code}.fix`, lang, args),
    };
  }
}
