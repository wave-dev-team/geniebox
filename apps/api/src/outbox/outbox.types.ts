import { z } from 'zod';

import { chatJobSchema, taskJobSchema } from '../queues/jobs.js';

export const outboxEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat.requested'), payload: chatJobSchema }),
  z.object({ type: z.literal('task.requested'), payload: taskJobSchema }),
]);

export type OutboxEvent = z.infer<typeof outboxEventSchema>;
