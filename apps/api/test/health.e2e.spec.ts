import request from 'supertest';

import type { INestApplication } from '@nestjs/common';

let app: INestApplication;

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgresql://geniebox_app@127.0.0.1:5432/geniebox_test';
  process.env.JWT_SECRET = 'only-used-by-the-http-test-suite';
  process.env.AUTH_IDENTITY_SECRET = 'only-used-by-the-http-test-suite';
  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  process.env.SMTP_URL = 'smtp://127.0.0.1:1025';
  process.env.AUTH_MAIL_FROM = 'test@geniebox.test';
  process.env.LLM_BASE_URL = '';
  const { createApp } = await import('../src/create-app.js');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
}, 15_000);

afterAll(async () => {
  await app?.close();
});

it('reports public liveness without exposing dependencies', async () => {
  const response = await request(app.getHttpServer()).get('/api/health').expect(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(response.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
});

it('returns a traceable localized error for unknown routes', async () => {
  const response = await request(app.getHttpServer())
    .get('/api/docs')
    .set('Accept-Language', 'en')
    .expect(404);
  expect(response.body).toMatchObject({
    code: 'NOT_FOUND',
    message: 'Resource not found.',
    traceId: response.headers['x-request-id'],
  });
});
