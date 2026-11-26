import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Global, Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';

import { resolveRequestId } from './request-id.js';

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: IncomingMessage) => resolveRequestId(req),
        setup: (_cls, req: IncomingMessage, res: ServerResponse) => {
          resolveRequestId(req, res);
        },
      },
      // Queue processors and sweepers open their own CLS contexts via ClsService.run().
      guard: { mount: false },
      interceptor: { mount: false },
    }),
  ],
})
export class ContextModule {}

/** Trace id for work that does not originate from an HTTP request (cron, relay loops). */
export function newTraceId(): string {
  return randomUUID();
}
