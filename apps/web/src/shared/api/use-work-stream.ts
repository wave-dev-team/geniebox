'use client';

import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { z } from 'zod';

import type { ChatMessage } from '@workspace/types';

import { projectChat } from './index';

const eventSchema = z.union([
  z.object({ type: z.literal('manager.context_reset') }),
  z.object({ type: z.literal('task.updated'), taskId: z.uuid() }),
  z.object({ type: z.literal('routine.updated'), routineId: z.uuid() }),
  z.object({
    type: z.enum(['message.created', 'message.updated', 'message.delta']),
    conversationId: z.uuid(),
    messageId: z.uuid(),
    delta: z.string().optional(),
  }),
]);

async function readStream(response: Response, receive: (data: string) => void) {
  if (!response.body) throw new Error('Empty stream');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) receive(data);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function useWorkStream(account: string, project: string) {
  const client = useQueryClient();
  const [partial, setPartial] = useState<Record<string, string>>({});
  useEffect(() => {
    const controller = new AbortController();
    const api = projectChat(account, project);
    const scope = ['chat', account, project];
    let timer: ReturnType<typeof setTimeout>;
    let delay = 1000;
    async function connect() {
      try {
        const response = await api.stream(controller.signal);
        delay = 1000;
        setPartial({});
        // Recover any events missed while the tab was disconnected.
        void client.invalidateQueries({ queryKey: scope });
        await readStream(response, (data) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            return;
          }
          const event = eventSchema.safeParse(parsed);
          if (!event.success) return;
          if (event.data.type === 'manager.context_reset') {
            setPartial({});
            void client.resetQueries({ queryKey: scope });
            return;
          }
          if (event.data.type === 'task.updated') {
            void client.invalidateQueries({ queryKey: ['project-tasks', account, project] });
            void client.invalidateQueries({ queryKey: ['project-task-counts', account, project] });
            void client.invalidateQueries({
              queryKey: ['project-task', account, project, event.data.taskId],
            });
            return;
          }
          if (event.data.type === 'routine.updated') {
            void client.invalidateQueries({ queryKey: ['project-routines', account, project] });
            void client.invalidateQueries({ queryKey: ['project-task-counts', account, project] });
            return;
          }
          const { type, conversationId, messageId, delta } = event.data;
          const key = [...scope, 'messages', conversationId];
          if (type === 'message.delta') {
            if (!delta) return;
            const cached = client.getQueryData<InfiniteData<ChatMessage[]>>(key);
            const prefix = cached?.pages[0]?.find((message) => message.id === messageId)?.text ?? '';
            setPartial((current) => ({ ...current, [messageId]: (current[messageId] ?? prefix) + delta }));
            return;
          }
          if (type === 'message.created') {
            void client.invalidateQueries({ queryKey: [...scope, 'list'] });
          }
          void client.invalidateQueries({ queryKey: key }).then(() => {
            if (type !== 'message.updated' || controller.signal.aborted) return;
            setPartial((current) => {
              const next = { ...current };
              delete next[messageId];
              return next;
            });
          });
        });
      } catch {
        if (controller.signal.aborted) return;
      }
      if (!controller.signal.aborted) {
        timer = setTimeout(() => void connect(), delay);
        delay = Math.min(delay * 2, 15000);
      }
    }
    void connect();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [account, project, client]);
  return partial;
}
