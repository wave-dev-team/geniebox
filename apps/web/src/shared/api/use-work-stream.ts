'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export function useWorkStream(topic: 'chat' | 'tasks', tenantId?: string, userId?: string) {
  const client = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!tenantId || !userId) return;
    const key = [topic === 'chat' ? 'manager-chat' : 'tasks', tenantId, userId];
    const stream = new EventSource(`/api/v1/stream?workspace=${encodeURIComponent(tenantId)}`);
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      refresh ??= setTimeout(() => {
        refresh = undefined;
        void client.invalidateQueries({ queryKey: key });
      }, 150);
    };
    stream.addEventListener('ready', () => {
      setConnected(true);
      invalidate();
    });
    stream.addEventListener(topic, invalidate);
    stream.addEventListener('work', invalidate);
    stream.onerror = () => setConnected(false);
    return () => {
      clearTimeout(refresh);
      stream.close();
      setConnected(false);
    };
  }, [client, tenantId, topic, userId]);

  return connected;
}
