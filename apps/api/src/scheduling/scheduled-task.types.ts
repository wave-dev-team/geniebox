import type { z } from 'zod';

export const SCHEDULED_TASK_STATUSES = ['pending', 'enqueued', 'succeeded', 'failed', 'cancelled'] as const;
export type ScheduledTaskStatus = (typeof SCHEDULED_TASK_STATUSES)[number];

export interface ScheduleTaskInput<TPayload> {
  type: string;
  payload: TPayload;
  runAt: Date;
  /** Re-scheduling with the same (type, dedupeKey) is a no-op. */
  dedupeKey?: string;
}

export interface ScheduledTaskContext {
  taskId: string;
  accountId: string;
  runAt: Date;
}

/** A handler owns one task type and validates its payload; it must be idempotent. */
export interface ScheduledTaskHandler<TSchema extends z.ZodType = z.ZodType> {
  readonly type: string;
  readonly payloadSchema: TSchema;
  handle(payload: z.infer<TSchema>, context: ScheduledTaskContext): Promise<void>;
}
