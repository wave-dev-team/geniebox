import { z } from 'zod';

export const chatQueue = 'chat-generate';
export const tasksQueue = 'tasks-run';
export const modelAttempts = 3;

const base = z.object({ tenantId: z.uuid(), userId: z.uuid(), traceId: z.string().min(1).max(128) });
export const chatJobSchema = base.extend({ turnId: z.uuid() });
export const taskJobSchema = base.extend({ taskId: z.uuid(), runId: z.uuid() });

export type ChatJob = z.infer<typeof chatJobSchema>;
export type TaskJob = z.infer<typeof taskJobSchema>;

export const chatJobId = (job: ChatJob) => `t-${job.tenantId}-${job.userId}-${job.turnId}`;
export const taskJobId = (job: TaskJob) => `t-${job.tenantId}-${job.userId}-${job.taskId}-${job.runId}`;

export const modelJobOptions = {
  attempts: modelAttempts,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
};
