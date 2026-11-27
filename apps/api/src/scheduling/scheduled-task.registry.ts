import type { z } from 'zod';

import { Injectable } from '@nestjs/common';

import type { ScheduledTaskHandler } from './scheduled-task.types.js';

/** Feature modules register their handlers in onModuleInit. */
@Injectable()
export class ScheduledTaskRegistry {
  private readonly handlers = new Map<string, ScheduledTaskHandler>();

  register<TSchema extends z.ZodType>(handler: ScheduledTaskHandler<TSchema>): void {
    if (this.handlers.has(handler.type)) {
      throw new Error(`Scheduled task handler "${handler.type}" is already registered`);
    }
    // Payload is re-validated against handler.payloadSchema before every call.
    this.handlers.set(handler.type, handler);
  }

  get(type: string): ScheduledTaskHandler | undefined {
    return this.handlers.get(type);
  }
}
