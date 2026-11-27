/**
 * Live events of a project: the SSE stream carries ids, the client refetches what it
 * shows. Only message deltas carry content, so a streamed answer appears as it is written.
 */
export type ProjectStreamEvent =
  | { type: 'message.created'; recipientUserId: string; conversationId: string; messageId: string }
  | {
      type: 'message.delta';
      recipientUserId: string;
      conversationId: string;
      messageId: string;
      delta: string;
    }
  | { type: 'message.updated'; recipientUserId: string; conversationId: string; messageId: string }
  | { type: 'manager.context_reset'; recipientUserId: string | null }
  | { type: 'task.updated'; taskId: string }
  | { type: 'decision.updated'; decisionId: string }
  | { type: 'routine.updated'; routineId: string }
  | { type: 'agent.updated'; agentId: string }
  | { type: 'metrics.updated' }
  | { type: 'knowledge.updated'; nodeId: string }
  | { type: 'knowledge.source'; sourceId: string };

export const streamChannel = (projectId: string): string => `geniebox:stream:project:${projectId}`;
export const STREAM_CHANNEL_PATTERN = 'geniebox:stream:project:*';
