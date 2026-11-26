import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { DomainException } from '../../common/exceptions/index.js';

/** A domain error as the person reads it (outside HTTP, where the global filter does this). */
@Injectable()
export class ErrorText {
  constructor(private readonly i18n: I18nService) {}

  of(error: unknown, lang: string): string {
    if (error instanceof DomainException) {
      const text = this.i18n.t(error.messageKey, { lang, args: error.messageArgs });
      return typeof text === 'string' && text !== error.messageKey ? text : error.code;
    }
    return lang === 'en' ? 'Something went wrong' : 'Не получилось выполнить';
  }
}
