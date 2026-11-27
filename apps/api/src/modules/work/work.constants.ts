export const TASK_STATUSES = ['planned', 'running', 'waiting', 'failed', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const ACTIVE_TASK_STATUSES: TaskStatus[] = ['planned', 'running', 'waiting', 'failed'];
export const FINISHED_TASK_STATUSES: TaskStatus[] = ['done', 'cancelled'];

export const WAITING_REASONS = ['decision', 'subtasks', 'connection'] as const;
export type WaitingReason = (typeof WAITING_REASONS)[number];

export const TASK_ORIGINS = ['owner', 'manager', 'agent', 'routine', 'check'] as const;
export type TaskOrigin = (typeof TASK_ORIGINS)[number];

export const STEP_STATUSES = ['todo', 'current', 'done', 'failed'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/** Request mode: stricter than the agent's trust or only advice. */
export const REQUEST_MODES = ['approve_all', 'approve_important', 'recommend_only'] as const;
export type RequestMode = (typeof REQUEST_MODES)[number];

export const DECISION_STATUSES = ['pending', 'accepted', 'modified', 'rejected', 'expired'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export const DECIDED_STATUSES: DecisionStatus[] = ['accepted', 'modified', 'rejected', 'expired'];

export const RISKS = ['low', 'medium', 'high'] as const;
export type Risk = (typeof RISKS)[number];

export const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;
export const MESSAGE_STATUSES = ['streaming', 'done', 'failed'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export interface Card {
  /** chart: `id` is a metric, `days` the period (the manager's send_chart). */
  type: 'task' | 'decision' | 'chart';
  id: string;
  days?: number;
}

export interface Fact {
  label: string;
  value: string;
}

export interface TaskError {
  code: string;
  what: string;
  fix: string | null;
}

export interface TermOption {
  value: string;
  label: string;
  effect: string | null;
  cost: string | null;
}

export interface DecisionTerms {
  label: string;
  proposed: string;
  options: TermOption[];
}

export interface PendingAction {
  toolId: string;
  args: Record<string, unknown>;
}

/** Messages kept in a conversation's model context. */
export const CONTEXT_MESSAGES = 20;
