'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import type { ChatHistory, SendChatMessage } from '@workspace/types';

import { useMe } from '@/entities/session';
import { ApiError, chatApi } from '@/shared/api';
import { useWorkStream } from '@/shared/api/use-work-stream';

export function useManagerChat() {
  const { data: me } = useMe();
  const queryKey = ['manager-chat', me?.tenantId, me?.id] as const;
  const client = useQueryClient();
  const streaming = useWorkStream('chat', me?.tenantId, me?.id);
  const currentRequest = useRef<SendChatMessage>(null);
  const submitting = useRef(false);

  const history = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const page = await chatApi.history(undefined, signal);
      const cached = client.getQueryData<ChatHistory>(queryKey);
      const overlap = cached?.turns.findIndex(({ id }) => id === page.turns[0]?.id) ?? -1;
      if (cached && overlap > 0) {
        return {
          ...page,
          turns: [...cached.turns.slice(0, overlap), ...page.turns],
          nextCursor: cached.nextCursor,
        };
      }
      return page;
    },
    enabled: Boolean(me),
    staleTime: 0,
    refetchInterval: ({ state }) =>
      state.data?.turns.some((turn) => turn.status === 'pending') ? (streaming ? 8000 : 850) : false,
  });
  const mutation = useMutation({
    mutationFn: chatApi.send,
    onSuccess: async (turn) => {
      await client.cancelQueries({ queryKey, exact: true });
      client.setQueryData<ChatHistory>(queryKey, (data) => {
        if (!data) return { enabled: true, turns: [turn], nextCursor: null };
        if (data.turns.some(({ id }) => id === turn.id)) return data;
        return { ...data, turns: [...data.turns, turn] };
      });
      void client.invalidateQueries({ queryKey, exact: true });
    },
    onError: () => void client.invalidateQueries({ queryKey, exact: true }),
  });

  const older = useMutation({
    mutationFn: (cursor: string) => chatApi.history(cursor),
    onSuccess: ({ turns, nextCursor }) => {
      client.setQueryData<ChatHistory>([...queryKey, 'archive'], (data) => ({
        enabled: true,
        turns: [...turns, ...(data?.turns ?? [])],
        nextCursor,
      }));
    },
  });
  const archive = useQuery<ChatHistory>({
    queryKey: [...queryKey, 'archive'],
    enabled: false,
    staleTime: Infinity,
  });

  async function send(message: string) {
    if (!me || submitting.current) return false;
    submitting.current = true;
    if (currentRequest.current?.message !== message) {
      currentRequest.current = { id: crypto.randomUUID(), message };
    }
    try {
      await mutation.mutateAsync(currentRequest.current);
      currentRequest.current = null;
      return true;
    } catch {
      return false;
    } finally {
      submitting.current = false;
    }
  }

  const pending = history.data?.turns.some((turn) => turn.status === 'pending') ?? false;
  const latest = history.data?.turns ?? [];
  const latestIds = new Set(latest.map(({ id }) => id));
  const archived = (archive.data?.turns ?? []).filter(({ id }) => !latestIds.has(id));
  const cursor = archive.data ? archive.data.nextCursor : history.data?.nextCursor;
  return {
    history,
    turns: [...archived, ...latest],
    pending,
    send,
    sending: mutation.isPending,
    sendError:
      mutation.error instanceof ApiError && mutation.error.status === 409
        ? 'busy'
        : mutation.isError
          ? 'sendError'
          : null,
    loadOlder: cursor ? () => older.mutate(cursor) : undefined,
    loadingOlder: older.isPending,
    olderError: older.isError,
  };
}
