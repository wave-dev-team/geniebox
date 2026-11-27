import { z } from 'zod';

export const chatMessageMaxLength = 4000;
export const chatRequestModes = ['approve_all', 'approve_important', 'recommend_only'] as const;
export type ChatRequestMode = (typeof chatRequestModes)[number];

export interface ChatRequest {
  text: string;
  mode: ChatRequestMode;
  mentionAgentId?: string;
}

export const conversationSchema = z.object({
  id: z.uuid(),
  agentId: z.uuid(),
  title: z.string().nullable(),
});

const chatCardSchema = z.object({
  id: z.uuid(),
  type: z.enum(['task', 'decision', 'chart']),
  days: z.number().optional(),
});

const chatActionSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['reply', 'action', 'link', 'decision']),
  label: z.string(),
  url: z.string().nullable(),
  status: z.enum(['pending', 'done', 'failed', 'expired']),
  result: z.string().nullable(),
});

export type ChatCard = z.infer<typeof chatCardSchema>;
export type ChatAction = z.infer<typeof chatActionSchema>;
export type ChatConversation = z.infer<typeof conversationSchema>;
export const messageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  text: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  status: z.enum(['streaming', 'done', 'failed']),
  createdAt: z.string(),
  agentId: z.uuid().nullable(),
  cards: z.array(chatCardSchema),
  actions: z.array(chatActionSchema),
  notificationKind: z
    .enum([
      'decision_accepted',
      'team_paused',
      'team_resumed',
      'rules_changed',
      'budget_changed',
      'connections_disconnected',
    ])
    .nullish(),
});
export type ChatMessage = z.infer<typeof messageSchema>;
