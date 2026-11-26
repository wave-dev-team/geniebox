import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { RoutinesService } from '../modules/routines/routines.service.js';

@Injectable()
export class SchedulingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulingService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(private readonly routines: RoutinesService) {}

  onModuleInit() {
    const sweep = () => {
      this.running ??= this.routines
        .tick()
        .catch(() => this.logger.warn('Task schedules could not be processed'))
        .finally(() => {
          this.running = undefined;
        });
    };
    sweep();
    this.timer = setInterval(sweep, 60_000);
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }
}
