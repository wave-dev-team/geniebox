export const ACTOR_TYPES = ['user', 'agent', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const JOURNAL_STATUSES = ['succeeded', 'failed', 'rejected'] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export interface JournalEntryInput {
  actor: { type: ActorType; id: string; role?: string };
  /** Stable action id, e.g. `users.subscription.reissue`. */
  action: string;
  target?: { type: string; id: string };
  args?: unknown;
  result?: unknown;
  status: JournalStatus;
}
