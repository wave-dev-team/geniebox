import request from 'supertest';

import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

import { ApiModule } from '../../src/api.module.js';
import { configureHttpApp } from '../../src/bootstrap/configure-http-app.js';
import { InternalModule } from '../../src/internal.module.js';
import { flushRedis } from '../support/helpers.js';

async function createApp(
  module: typeof ApiModule | typeof InternalModule,
  kind: 'public' | 'internal',
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [module] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  // Compiling a testing module re-installs the default logger.
  Logger.overrideLogger(false);
  configureHttpApp(app, { kind });
  await app.init();
  return app;
}

describe('public API', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    await flushRedis();
    app = await createApp(ApiModule, 'public');
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves liveness without auth and echoes a safe request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('X-Request-Id', 'upstream-123456')
      .expect(200, { status: 'ok' });
    expect(response.headers['x-request-id']).toBe('upstream-123456');
  });

  it('returns the unified error body, Russian by default', async () => {
    const response = await request(app.getHttpServer()).get('/v1/missing').expect(404);
    expect(response.body).toMatchObject({
      statusCode: 404,
      code: 'ROUTE_NOT_FOUND',
      message: 'Маршрут не найден',
      traceId: response.headers['x-request-id'],
    });
  });

  it('localizes messages from Accept-Language without changing the code', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/missing')
      .set('Accept-Language', 'en-US,en;q=0.9')
      .expect(404);
    expect(response.body).toMatchObject({ code: 'ROUTE_NOT_FOUND', message: 'Route not found' });
  });

  it('sets security headers', async () => {
    const response = await request(app.getHttpServer()).get('/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('internal API', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp(InternalModule, 'internal');
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports every dependency separately', async () => {
    const response = await request(app.getHttpServer()).get('/health/details').expect(200);
    expect(Object.keys(response.body.details as object).sort()).toEqual([
      'postgres_app',
      'postgres_system',
      'redis_cache',
      'redis_state',
    ]);
  });
});
