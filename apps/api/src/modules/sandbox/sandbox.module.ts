import { Module } from '@nestjs/common';

import { DemoSandboxController } from './sandbox.controller.js';
import { DemoSandboxService } from './sandbox.service.js';

@Module({
  controllers: [DemoSandboxController],
  providers: [DemoSandboxService],
})
export class DemoSandboxModule {}
