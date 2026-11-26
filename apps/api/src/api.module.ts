import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard } from '@nestjs/throttler';

import { JwtGuard } from './common/guards/jwt.guard.js';
import { SameOriginGuard } from './common/guards/same-origin.guard.js';
import { AppThrottlerModule } from './common/throttler/throttler.module.js';
import { CoreModule } from './core.module.js';
import { HttpCommonModule } from './http-common.module.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { ActionsModule } from './modules/actions/actions.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { ConnectionsModule } from './modules/connections/connections.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { RoutinesModule } from './modules/routines/routines.module.js';
import { StreamModule } from './modules/stream/stream.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';

@Module({
  imports: [
    CoreModule,
    HttpCommonModule,
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    AppThrottlerModule,
    AuthModule,
    AccountsModule,
    ActionsModule,
    ChatModule,
    ConnectionsModule,
    ReportsModule,
    RoutinesModule,
    TasksModule,
    StreamModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: SameOriginGuard },
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class ApiModule {}
