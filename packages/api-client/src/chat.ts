import { z } from 'zod';

import { type ChatRequest, conversationSchema, messageSchema } from '@workspace/types';

import { projectPath } from './accounts.js';
import { authenticated } from './authenticated.js';

export function projectChat(account: string, project: string) {
  const scope = projectPath(account, project);
  const base = scope + '/conversations';
  const messages = (id: string) => `${base}/${encodeURIComponent(id)}/messages`;
  const get = async <T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal) =>
    schema.parse(await (await authenticated(scope + path, { signal })).json());
  return {
    list: async (signal?: AbortSignal, agentId?: string) =>
      conversationSchema
        .array()
        .parse(
          await (
            await authenticated(base + (agentId ? '?agentId=' + encodeURIComponent(agentId) : ''), { signal })
          ).json(),
        ),
    manager: async (signal?: AbortSignal) =>
      (await get('/conversations/manager', z.object({ conversation: conversationSchema.nullable() }), signal))
        .conversation,
    create: async () =>
      conversationSchema.parse(await (await authenticated(base, { method: 'POST', body: '{}' })).json()),
    history: async (id: string, signal?: AbortSignal, beforeId?: string) =>
      messageSchema.array().parse(
        await (
          await authenticated(messages(id) + (beforeId ? '?beforeId=' + encodeURIComponent(beforeId) : ''), {
            signal,
          })
        ).json(),
      ),
    send: async (id: string, request: ChatRequest) =>
      z.object({ message: messageSchema, reply: messageSchema }).parse(
        await (
          await authenticated(messages(id), {
            method: 'POST',
            body: JSON.stringify(request),
          })
        ).json(),
      ),
    press: async (actionId: string) =>
      z.object({ status: z.enum(['done', 'failed']), text: z.string(), url: z.string().nullable() }).parse(
        await (
          await authenticated(scope + '/message-actions/' + encodeURIComponent(actionId) + '/press', {
            method: 'POST',
          })
        ).json(),
      ),
    task: (id: string, signal?: AbortSignal) =>
      get(
        '/tasks/' + encodeURIComponent(id),
        z.object({
          title: z.string(),
          status: z.enum(['planned', 'running', 'waiting', 'failed', 'done', 'cancelled']),
          summary: z.string().nullable(),
          progressText: z.string().nullable(),
          progressPct: z.number().nullable(),
          result: z.string().nullable(),
        }),
        signal,
      ),
    decision: (id: string, signal?: AbortSignal) =>
      get(
        '/decisions/' + encodeURIComponent(id),
        z.object({
          title: z.string(),
          taskId: z.uuid().nullable(),
          meta: z.string().nullable(),
          effect: z.string().nullable(),
          cost: z.string().nullable(),
        }),
        signal,
      ),
    chart: async (id: string, days: number, signal?: AbortSignal) => {
      const [metrics, points] = await Promise.all([
        get('/metrics', z.array(z.object({ id: z.uuid(), title: z.string() })), signal),
        get(
          '/metrics/' + encodeURIComponent(id) + '/series?days=' + days,
          z.array(z.object({ day: z.string(), value: z.number() })),
          signal,
        ),
      ]);
      return { title: metrics.find((metric) => metric.id === id)?.title, points };
    },
    stream: (signal: AbortSignal) =>
      authenticated(scope + '/stream', { signal, headers: { Accept: 'text/event-stream' } }),
  };
}
