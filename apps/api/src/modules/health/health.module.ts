import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller.js';
import { HealthDetailsController } from './health-details.controller.js';

@Module({ controllers: [HealthController] })
export class PublicHealthModule {}

@Module({
  imports: [TerminusModule.forRoot({ logger: false })],
  controllers: [HealthController, HealthDetailsController],
})
export class InternalHealthModule {}
