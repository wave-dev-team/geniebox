/**
 * Live events of a project: the SSE stream carries ids, the client refetches what it
 * shows. Only message deltas carry content, so a streamed answer appears as it is written.
 */
export type ProjectStreamEvent =
  | { type: 'message.created'; conversationId: string; messageId: string }
  | { type: 'message.delta'; conversationId: string; messageId: string; delta: string }
  | { type: 'message.updated'; conversationId: string; messageId: string }
  | { type: 'task.updated'; taskId: string }
  | { type: 'decision.updated'; decisionId: string }
  | { type: 'routine.updated'; routineId: string }
  | { type: 'agent.updated'; agentId: string }
  | { type: 'metrics.updated' };

export const streamChannel = (projectId: string): string => `geniebox:stream:project:${projectId}`;
export const STREAM_CHANNEL_PATTERN = 'geniebox:stream:project:*';
