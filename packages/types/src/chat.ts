import { z } from 'zod';

export const chatMessageMaxLength = 4000;
export const sendChatMessageSchema = z.strictObject({
  id: z.uuid(),
  message: z
    .string()
    .trim()
    .min(1)
    .max(chatMessageMaxLength)
    .refine((value) => !value.includes('\u0000')),
});

export const agentTaskSchema = z.object({
  agentId: z.uuid(),
  agentName: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  result: z.string().nullable(),
});
export type AgentTask = z.infer<typeof agentTaskSchema>;

export const chatTurnSchema = z.object({
  id: z.uuid(),
  message: z.string(),
  answer: z.string().nullable(),
  status: z.enum(['pending', 'completed', 'failed', 'limited']),
  createdAt: z.iso.datetime(),
  tasks: z.array(agentTaskSchema),
});

export const chatHistorySchema = z.object({
  enabled: z.boolean(),
  turns: z.array(chatTurnSchema),
  nextCursor: z.uuid().nullable(),
});

export type SendChatMessage = z.infer<typeof sendChatMessageSchema>;
export type ChatTurn = z.infer<typeof chatTurnSchema>;
export type ChatHistory = z.infer<typeof chatHistorySchema>;
