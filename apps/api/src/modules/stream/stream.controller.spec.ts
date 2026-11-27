import type { MessageEvent } from '@nestjs/common';

import type { ProjectContext } from '../projects/project-context.js';
import { StreamController } from './stream.controller.js';
import type { ProjectStreamEvent } from './stream.events.js';
import type { StreamHub } from './stream.hub.js';

describe('project stream message privacy', () => {
  it('sends deltas only to the designated user and keeps common events available', () => {
    const listeners = new Set<(event: ProjectStreamEvent) => void>();
    const hub = {
      subscribe: (_project: string, listener: (event: ProjectStreamEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as StreamHub;
    const open = (userId: string, messages: MessageEvent[]) => {
      const context = { actor: () => ({ projectId: 'project', userId }) } as ProjectContext;
      return new StreamController(hub, context).stream().subscribe((event) => messages.push(event));
    };
    const owner: MessageEvent[] = [];
    const other: MessageEvent[] = [];
    const ownerStream = open('owner', owner);
    const otherStream = open('other', other);
    try {
      for (const listener of listeners) {
        listener({
          type: 'message.delta',
          conversationId: 'chat',
          messageId: 'reply',
          recipientUserId: 'owner',
          delta: 'private',
        });
        listener({ type: 'manager.context_reset', recipientUserId: 'owner' });
        listener({ type: 'manager.context_reset', recipientUserId: null });
        listener({ type: 'metrics.updated' });
      }
      expect(owner).toEqual([
        { type: 'ready', data: {} },
        {
          type: 'message.delta',
          data: { type: 'message.delta', conversationId: 'chat', messageId: 'reply', delta: 'private' },
        },
        { type: 'manager.context_reset', data: { type: 'manager.context_reset' } },
        { type: 'manager.context_reset', data: { type: 'manager.context_reset' } },
        { type: 'metrics.updated', data: { type: 'metrics.updated' } },
      ]);
      expect(other).toEqual([
        { type: 'ready', data: {} },
        { type: 'manager.context_reset', data: { type: 'manager.context_reset' } },
        { type: 'metrics.updated', data: { type: 'metrics.updated' } },
      ]);
    } finally {
      ownerStream.unsubscribe();
      otherStream.unsubscribe();
    }
  });
});
