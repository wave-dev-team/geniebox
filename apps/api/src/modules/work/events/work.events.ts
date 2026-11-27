export const WORK_EVENTS = {
  /** A user wrote in a conversation: the manager or the agent answers (worker). */
  MESSAGE_POSTED: 'work.message_posted',
  /** A task should run now (created, «Запустить сейчас», «Повторить»). */
  TASK_RUN_REQUESTED: 'work.task_run_requested',
  /** A pending decision was decided: execute or close its task. */
  DECISION_DECIDED: 'work.decision_decided',
  /** A routine was created, enabled, disabled or rescheduled. */
  ROUTINE_CHANGED: 'work.routine_changed',
  /** An assistant message is final (answer finished, agent reported back): mirrors pick it up. */
  MESSAGE_READY: 'work.message_ready',
  /** A decision waits for a person (proposal or an approval-mode action). */
  DECISION_CREATED: 'work.decision_created',
  /** A task ended: done (routine results such as «Итоги дня») or failed (incidents). */
  TASK_FINISHED: 'work.task_finished',
} as const;

export interface MessagePostedEvent {
  projectId: string;
  conversationId: string;
  userMessageId: string;
  replyMessageId: string;
  byUserId: string;
}

export interface TaskRunRequestedEvent {
  projectId: string;
  taskId: string;
  byUserId: string | null;
}

export interface DecisionDecidedEvent {
  projectId: string;
  decisionId: string;
  byUserId: string;
}

export interface MessageReadyEvent {
  projectId: string;
  conversationId: string;
  messageId: string;
}

export interface DecisionCreatedEvent {
  projectId: string;
  decisionId: string;
}

export interface TaskFinishedEvent {
  projectId: string;
  taskId: string;
  status: 'done' | 'failed';
  routineKind: string | null;
}

export interface RoutineChangedEvent {
  projectId: string;
  routineId: string;
  byUserId: string | null;
}

export const WORK_TASKS = {
  /** Runs a routine at its next_run_at and schedules the following run. */
  ROUTINE_RUN: 'work.routine_run',
} as const;
