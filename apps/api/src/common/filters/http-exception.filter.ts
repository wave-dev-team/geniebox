import type { Response } from 'express';

import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { I18nContext, I18nService } from 'nestjs-i18n';
import { PinoLogger } from 'nestjs-pino';

const errorCodes = new Map<number, string>([
  [400, 'BAD_REQUEST'],
  [401, 'UNAUTHORIZED'],
  [403, 'FORBIDDEN'],
  [404, 'NOT_FOUND'],
  [429, 'RATE_LIMITED'],
  [503, 'SERVICE_UNAVAILABLE'],
]);

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly context: ClsService,
    private readonly i18n: I18nService,
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const code = errorCodes.get(statusCode) ?? (statusCode >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR');
    const traceId = this.context.getId();

    if (statusCode >= 500) {
      this.logger.error({ traceId, statusCode, code }, 'HTTP request failed');
    }

    host
      .switchToHttp()
      .getResponse<Response>()
      .status(statusCode)
      .json({
        statusCode,
        code,
        message: this.i18n.translate(`errors.${code}`, { lang: I18nContext.current(host)?.lang }),
        traceId,
        timestamp: new Date().toISOString(),
      });
  }
}
