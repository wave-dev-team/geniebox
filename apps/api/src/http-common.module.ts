import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

/** HTTP-only cross-cutting providers shared by both listeners. Each listener sets its own auth guard. */
@Module({
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class HttpCommonModule {}
