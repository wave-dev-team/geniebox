import { Module } from '@nestjs/common';

import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { CoreModule } from './core.module.js';

@Module({ imports: [CoreModule], providers: [HttpExceptionFilter], exports: [HttpExceptionFilter] })
export class HttpCommonModule {}
