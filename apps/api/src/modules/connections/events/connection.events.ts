export const CONNECTION_EVENTS = {
  CREATED: 'connection.created',
  UPDATED: 'connection.updated',
  ROTATED: 'connection.rotated',
  PROJECT_DISCONNECTED: 'connection.project_disconnected',
  DISCONNECTED: 'connection.disconnected',
  STATUS_CHANGED: 'connection.status_changed',
  LINK_CREATED: 'connection.link_created',
  LINK_USED: 'connection.link_used',
} as const;

export interface ConnectionEvent {
  projectId: string;
  connectionId: string;
  providerKey: string;
  byUserId: string | null;
}

export interface ConnectionStatusChangedEvent extends ConnectionEvent {
  from: string;
  to: string;
  reason: string | null;
}
