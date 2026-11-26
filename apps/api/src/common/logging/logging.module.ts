import type { IncomingMessage, ServerResponse } from 'node:http';

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsServiceManager } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';

import type { Env } from '../../config/env.schema.js';
import type { AppClsStore } from '../context/app-cls-store.js';
import { resolveRequestId } from '../context/request-id.js';

/** Paths are never written to logs. Extend when a new PII/secret field appears. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  "req.headers['x-api-key']",
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.email',
  '*.phone',
];

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
          genReqId: (req: IncomingMessage, res: ServerResponse) => resolveRequestId(req, res),
          // traceId/accountId on every line, including logs from queue jobs.
          mixin: () => {
            const cls = ClsServiceManager.getClsService<AppClsStore>();
            if (!cls.isActive()) {
              return {};
            }
            const accountId = cls.get('accountId');
            return { traceId: cls.getId(), ...(accountId ? { accountId } : {}) };
          },
          customLogLevel: (_req, res, err) => {
            if (err || res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
          },
          autoLogging: { ignore: (req) => req.url === '/health' },
          // Keep request logs compact: full headers are noise and a PII risk.
          serializers: {
            req: (req: { id: string; method: string; url: string; remoteAddress?: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
              remoteAddress: req.remoteAddress,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
  ],
})
export class LoggingModule {}
