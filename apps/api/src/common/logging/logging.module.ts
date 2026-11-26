import type { Response } from 'express';

import { Module } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        quietReqLogger: true,
        serializers: {
          req: () => undefined,
          res: (response: Pick<Response, 'statusCode'>) => ({ statusCode: response.statusCode }),
        },
        customProps: () => {
          const context = ClsServiceManager.getClsService();
          return { traceId: context.getId(), tenantId: context.get('tenantId') };
        },
      },
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
