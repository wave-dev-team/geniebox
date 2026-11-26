/** Outbox events and scheduled task types of metrics and checks. */
export const METRICS_EVENTS = {
  /** A person changed the source or asked to collect now. */
  COLLECT_REQUESTED: 'metrics.collect_requested',
} as const;

export const METRICS_TASKS = {
  /** Collect one metric, then schedule the next run. */
  COLLECT: 'metrics.collect',
  /** A check is due: the agent gets a task to check its proposal. */
  CHECK_RUN: 'checks.run',
} as const;

export interface MetricCollectRequestedEvent {
  projectId: string;
  metricId: string;
}
