import { z } from 'zod';

export const chatMessageMaxLength = 4000;
export const conversationSchema = z.object({ id: z.uuid(), title: z.string().nullable() });
export const messageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  text: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  status: z.enum(['streaming', 'done', 'failed']),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof messageSchema>;
