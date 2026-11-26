import { chatHistorySchema, chatTurnSchema, type SendChatMessage } from '@workspace/types';

import { authenticated } from './authenticated.js';

export const chatApi = {
  history: async (before?: string, signal?: AbortSignal) =>
    chatHistorySchema.parse(
      await (
        await authenticated(before ? `/v1/chat?before=${encodeURIComponent(before)}` : '/v1/chat', {
          signal,
        })
      ).json(),
    ),
  send: async (input: SendChatMessage) =>
    chatTurnSchema.parse(
      await (await authenticated('/v1/chat', { method: 'POST', body: JSON.stringify(input) })).json(),
    ),
};
