import type { Response } from 'express';

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';
import { ClsService } from 'nestjs-cls';
import { I18nContext, I18nService } from 'nestjs-i18n';

import type { Env } from '../../config/env.schema.js';
import type { AppClsStore } from '../context/app-cls-store.js';
import { DomainException, ErrorCode } from '../exceptions/index.js';
import { DEFAULT_LOCALE } from '../i18n/locales.js';

export interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  traceId: string | undefined;
  timestamp: string;
}

interface NormalizedError {
  status: number;
  code: string;
  messageKey: string;
  messageArgs?: Record<string, unknown>;
  details?: unknown;
}

const HTTP_STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.ROUTE_NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
};

const isServerError = (status: number): boolean => status >= 500;

/** Single place where exceptions become HTTP responses. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly isProduction: boolean;

  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly i18n: I18nService,
    config: ConfigService<Env, true>,
  ) {
    this.isProduction = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw exception;
    }
    const response = host.switchToHttp().getResponse<Response>();
    const error = this.normalize(exception);

    if (isServerError(error.status)) {
      this.logger.error({ err: exception, code: error.code }, 'Unhandled error');
    }

    const body: ErrorResponseBody = {
      statusCode: error.status,
      code: error.code,
      message: this.translate(error, host),
      ...(error.details === undefined ? {} : { details: error.details }),
      traceId: this.cls.isActive() ? this.cls.getId() : undefined,
      timestamp: new Date().toISOString(),
    };
    if (!this.isProduction && isServerError(error.status)) {
      Object.assign(body, { debug: exception instanceof Error ? exception.message : exception });
    }

    response.status(error.status).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof DomainException) {
      return {
        status: exception.status,
        code: exception.code,
        messageKey: exception.messageKey,
        messageArgs: exception.messageArgs,
        details: exception.details,
      };
    }
    if (exception instanceof ThrottlerException) {
      return this.fromCode(HttpStatus.TOO_MANY_REQUESTS, ErrorCode.TOO_MANY_REQUESTS);
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        HTTP_STATUS_CODES[status] ?? (isServerError(status) ? ErrorCode.INTERNAL_ERROR : `HTTP_${status}`);
      return this.fromCode(status, code);
    }
    return this.fromCode(HttpStatus.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_ERROR);
  }

  private fromCode(status: number, code: string): NormalizedError {
    return { status, code, messageKey: `errors.${code}` };
  }

  private translate(error: NormalizedError, host: ArgumentsHost): string {
    const options = { args: error.messageArgs };
    const context = I18nContext.current(host);
    const translated = context
      ? context.t(error.messageKey, options)
      : this.i18n.t(error.messageKey, { ...options, lang: DEFAULT_LOCALE });
    // nestjs-i18n returns the key itself when a translation is missing.
    return typeof translated === 'string' && translated !== error.messageKey ? translated : error.code;
  }
}
