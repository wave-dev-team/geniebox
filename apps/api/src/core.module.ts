import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { ContextModule } from './common/context/context.module.js';
import { AppI18nModule } from './common/i18n/i18n.module.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { appEnvironment } from './config/environment.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (env) => appEnvironment.parse(env) }),
    ContextModule,
    LoggingModule,
    AppI18nModule,
    EventEmitterModule.forRoot(),
  ],
  exports: [LoggingModule],
})
export class CoreModule {}
