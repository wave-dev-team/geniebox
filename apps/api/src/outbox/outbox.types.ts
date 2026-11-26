import { z } from 'zod';

import { mailJobSchema } from '../modules/mail/mail.types.js';
import { chatJobSchema, taskJobSchema } from '../queues/jobs.js';

export const outboxEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat.requested'), payload: chatJobSchema }),
  z.object({ type: z.literal('task.requested'), payload: taskJobSchema }),
  z.object({ type: z.literal('mail.requested'), payload: mailJobSchema }),
]);

export type OutboxEvent = z.infer<typeof outboxEventSchema>;
