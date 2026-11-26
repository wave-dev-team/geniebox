import type { Response } from 'express';

import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';

import { newRequestId, requestIdHeader } from './request-id.js';

@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: newRequestId,
        setup: (context, _request, response: Response) => {
          response.setHeader(requestIdHeader, context.getId());
        },
      },
    }),
  ],
})
export class ContextModule {}
