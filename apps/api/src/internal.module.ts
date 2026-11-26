import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { DefaultDenyGuard } from './common/guards/default-deny.guard.js';
import { CoreModule } from './core.module.js';
import { HttpCommonModule } from './http-common.module.js';
import { InternalHealthModule } from './modules/health/health.module.js';

/**
 * Internal API process: binds to INTERNAL_HOST (private network only).
 * Hosts /internal/* for agents, detailed health and metrics. Service-token auth replaces
 * DefaultDenyGuard together with the first /internal/agent endpoint.
 */
@Module({
  imports: [CoreModule, HttpCommonModule, InternalHealthModule],
  providers: [{ provide: APP_GUARD, useClass: DefaultDenyGuard }],
})
export class InternalModule {}
