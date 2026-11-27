import { z } from 'zod';

import { conversationSchema, messageSchema } from '@workspace/types';

import { projectPath } from './accounts.js';
import { authenticated } from './authenticated.js';

export function projectChat(account: string, project: string) {
  const scope = projectPath(account, project);
  const base = scope + '/conversations';
  const messages = (id: string) => `${base}/${encodeURIComponent(id)}/messages`;
  return {
    list: async (signal?: AbortSignal) =>
      conversationSchema.array().parse(await (await authenticated(base, { signal })).json()),
    create: async () =>
      conversationSchema.parse(await (await authenticated(base, { method: 'POST', body: '{}' })).json()),
    history: async (id: string, signal?: AbortSignal, before?: string) =>
      messageSchema.array().parse(
        await (
          await authenticated(messages(id) + (before ? '?before=' + encodeURIComponent(before) : ''), {
            signal,
          })
        ).json(),
      ),
    send: async (id: string, text: string) =>
      z.object({ message: messageSchema, reply: messageSchema }).parse(
        await (
          await authenticated(messages(id), {
            method: 'POST',
            body: JSON.stringify({ text, mode: 'recommend_only' }),
          })
        ).json(),
      ),
    stream: (signal: AbortSignal) =>
      authenticated(scope + '/stream', { signal, headers: { Accept: 'text/event-stream' } }),
  };
}
