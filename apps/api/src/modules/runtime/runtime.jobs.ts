import { z } from 'zod';

export const turnJobSchema = z.object({
  accountId: z.uuid(),
  projectId: z.uuid(),
  conversationId: z.uuid(),
  userMessageId: z.uuid(),
  replyMessageId: z.uuid(),
  userId: z.uuid(),
  traceId: z.string().min(1),
});
export type TurnJob = z.infer<typeof turnJobSchema>;

export const taskJobSchema = z.object({
  accountId: z.uuid(),
  projectId: z.uuid(),
  taskId: z.uuid(),
  userId: z.uuid().nullable(),
  traceId: z.string().min(1),
});
export type TaskJob = z.infer<typeof taskJobSchema>;

export const RUNTIME_TASKS = {
  /** Expires a decision nobody answered in DECISION_TTL_DAYS. */
  DECISION_EXPIRE: 'runtime.decision_expire',
  /** Runs a delayed task at its scheduled_at time. */
  TASK_RUN: 'runtime.task_run',
} as const;
