'use client';

import { type InfiniteData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChartNoAxesColumn, Server, TrendingDown, Undo2 } from 'lucide-react';
import { useRef } from 'react';

import type { ChatMessage, ChatRequest } from '@workspace/types';

import { useMe } from '@/entities/session';
import { projectChat } from '@/shared/api';

export const chatSuggestions = [
  { key: 'churn', icon: TrendingDown },
  { key: 'winBack', icon: Undo2 },
  { key: 'day', icon: ChartNoAxesColumn },
  { key: 'servers', icon: Server },
] as const;

type ChatScope = { accountId: string; id: string };
type SendMessage = { conversation?: string; request: ChatRequest };

export function usePersonalManagerConversation(project: ChatScope) {
  const { data: me } = useMe();
  return useQuery({
    queryKey: ['chat', project.accountId, project.id, 'list', 'manager', me?.id],
    queryFn: ({ signal }) => projectChat(project.accountId, project.id).manager(signal),
    enabled: Boolean(me),
  });
}

export function useSendManagerMessage(project: ChatScope | undefined) {
  const client = useQueryClient();
  const draft = useRef<{ projectId: string; conversationId: string } | null>(null);

  return useMutation({
    mutationFn: async ({ conversation, request }: SendMessage) => {
      if (!project) throw new Error('Project required');
      const api = projectChat(project.accountId, project.id);
      let id = conversation;
      if (!id && draft.current?.projectId === project.id) id = draft.current.conversationId;
      if (!id) {
        id = (await api.create()).id;
        draft.current = { projectId: project.id, conversationId: id };
      }
      const response = await api.send(id, request);
      if (draft.current?.conversationId === id) draft.current = null;
      return { ...response, id, project };
    },
    onSuccess: ({ id, message, reply, project }) => {
      const scope = ['chat', project.accountId, project.id];
      const key = [...scope, 'messages', id];
      client.setQueryData<InfiniteData<ChatMessage[], string | undefined>>(key, (data) => {
        if (!data) return { pages: [[message, reply]], pageParams: [undefined] };
        const [latest = [], ...older] = data.pages;
        const added = [message, reply].filter((row) => !latest.some((existing) => existing.id === row.id));
        return { ...data, pages: [[...latest, ...added], ...older] };
      });
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: [...scope, 'list'] });
    },
  });
}
