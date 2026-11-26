import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import { type ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ClsService } from 'nestjs-cls';
import type { I18nService } from 'nestjs-i18n';

import type { Env } from '../../config/env.schema.js';
import type { AppClsStore } from '../context/app-cls-store.js';
import { ConflictException, ValidationException } from '../exceptions/index.js';
import { AllExceptionsFilter, type ErrorResponseBody } from './all-exceptions.filter.js';

function setup(nodeEnv: Env['NODE_ENV'] = 'production') {
  const cls = { isActive: () => true, getId: () => 'trace-1' } as unknown as ClsService<AppClsStore>;
  const i18n = {
    t: (key: string) => (key === 'errors.CONFLICT' ? 'Конфликт данных' : key),
  } as unknown as I18nService;
  const config = { get: () => nodeEnv } as unknown as ConfigService<Env, true>;
  const filter = new AllExceptionsFilter(cls, i18n, config);

  const json = jest.fn<(body: ErrorResponseBody) => void>();
  const status = jest.fn<(code: number) => { json: typeof json }>(() => ({ json }));
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => undefined, getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  const body = (): ErrorResponseBody => {
    const call = json.mock.calls[0];
    if (!call) throw new Error('response was not sent');
    return call[0];
  };
  return { filter, host, status, body };
}

describe('AllExceptionsFilter', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('maps a domain exception to the unified error format', () => {
    const { filter, host, status, body } = setup();
    filter.catch(new ConflictException(), host);
    expect(status).toHaveBeenCalledWith(409);
    expect(body()).toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      message: 'Конфликт данных',
      traceId: 'trace-1',
    });
  });

  it('falls back to the code when a translation is missing', () => {
    const { filter, host, body } = setup();
    filter.catch(new ValidationException([{ field: 'email', constraints: ['isEmail'] }]), host);
    expect(body()).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'VALIDATION_FAILED',
      details: [{ field: 'email', constraints: ['isEmail'] }],
    });
  });

  it('maps unknown routes and hides internals of unexpected errors in production', () => {
    const notFound = setup();
    notFound.filter.catch(new NotFoundException(), notFound.host);
    expect(notFound.body().code).toBe('ROUTE_NOT_FOUND');

    const crash = setup('production');
    crash.filter.catch(new Error('db password is hunter2'), crash.host);
    expect(crash.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(crash.body())).not.toContain('hunter2');
  });
});
