import type { DefaultJobOptions } from 'bullmq';

/** Queue names: `domain-action`, kebab-case. */
export const QUEUES = {
  OUTBOX_EVENTS: 'outbox-events',
  SCHEDULED_TASKS_SWEEP: 'scheduled-tasks-sweep',
  SCHEDULED_TASKS_RUN: 'scheduled-tasks-run',
  MAIL_SEND: 'mail-send',
  CONNECTIONS_CHECK: 'connections-check',
  CONNECTIONS_IMPORT: 'connections-import',
  CONNECTIONS_MAINTENANCE: 'connections-maintenance',
  AGENT_TURNS: 'agent-turns',
  AGENT_TASKS: 'agent-tasks',
  METRICS_COLLECT: 'metrics-collect',
  METRICS_MAINTENANCE: 'metrics-maintenance',
  CATALOG_SCENARIOS: 'catalog-scenarios',
  CATALOG_ROLLOUT: 'catalog-rollout',
  KNOWLEDGE_INDEX: 'knowledge-index',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const DAY_SECONDS = 24 * 60 * 60;

/** Explicit retry policy per queue; BullMQ defaults (1 attempt, no backoff) are never relied on. */
export const QUEUE_JOB_OPTIONS: Record<QueueName, DefaultJobOptions> = {
  [QUEUES.OUTBOX_EVENTS]: {
    attempts: 8,
    backoff: { type: 'exponential', delay: 1_000 },
    // Completed jobs are kept for a day so a re-enqueue of the same event id is deduplicated.
    removeOnComplete: { age: DAY_SECONDS },
    removeOnFail: { age: 14 * DAY_SECONDS },
  },
  [QUEUES.SCHEDULED_TASKS_SWEEP]: {
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 1_000 },
  },
  [QUEUES.MAIL_SEND]: {
    attempts: 6,
    backoff: { type: 'exponential', delay: 10_000 },
    // Payloads carry one-time codes and invitation tokens: keep them only as long as needed.
    removeOnComplete: true,
    removeOnFail: { age: DAY_SECONDS },
  },
  // A check is answered synchronously to the user; a failed check is a result, not a retry.
  [QUEUES.CONNECTIONS_CHECK]: {
    attempts: 1,
    removeOnComplete: { age: 60 * 60 },
    removeOnFail: { age: DAY_SECONDS },
  },
  // Retries live inside the LLM client; the popup needs a fast, honest answer instead.
  [QUEUES.CONNECTIONS_IMPORT]: {
    attempts: 1,
    // The result is the answer the popup polls for; it is read for an hour at most.
    removeOnComplete: { age: 60 * 60 },
    removeOnFail: { age: 60 * 60 },
  },
  [QUEUES.CONNECTIONS_MAINTENANCE]: {
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 1_000 },
  },
  // An answer is streamed to a waiting user: one attempt, a failure is shown in the dialog.
  [QUEUES.AGENT_TURNS]: {
    attempts: 1,
    removeOnComplete: { age: DAY_SECONDS },
    removeOnFail: { age: 7 * DAY_SECONDS },
  },
  // Provider errors are retried inside the LLM client; the job fails the task instead.
  [QUEUES.AGENT_TASKS]: {
    attempts: 1,
    removeOnComplete: { age: DAY_SECONDS },
    removeOnFail: { age: 7 * DAY_SECONDS },
  },
  // A failed collection is written under the metric; the sweep tries again an hour later.
  [QUEUES.METRICS_COLLECT]: {
    attempts: 1,
    removeOnComplete: { age: DAY_SECONDS },
    removeOnFail: { age: 7 * DAY_SECONDS },
  },
  [QUEUES.METRICS_MAINTENANCE]: {
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 1_000 },
  },
  // A failed run is written on the version («проверка не завершилась»); it can be started again.
  [QUEUES.CATALOG_SCENARIOS]: {
    attempts: 1,
    removeOnComplete: { age: DAY_SECONDS },
    removeOnFail: { age: 7 * DAY_SECONDS },
  },
  // Extraction and embeddings retry with backoff; the source keeps its error for a manual retry.
  [QUEUES.KNOWLEDGE_INDEX]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: DAY_SECONDS },
    removeOnFail: { age: 7 * DAY_SECONDS },
  },
  [QUEUES.CATALOG_ROLLOUT]: {
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 1_000 },
  },
  [QUEUES.SCHEDULED_TASKS_RUN]: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: DAY_SECONDS },
    removeOnFail: { age: 14 * DAY_SECONDS },
  },
};

/** BullMQ forbids ':' and pure integers in custom job ids. */
export function jobId(prefix: string, id: string): string {
  return `${prefix}-${id}`;
}
