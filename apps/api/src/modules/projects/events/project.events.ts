export const PROJECT_EVENTS = {
  CREATED: 'project.created',
  UPDATED: 'project.updated',
  RULES_UPDATED: 'project.rules_updated',
  PAUSED: 'project.paused',
  RESUMED: 'project.resumed',
  ONBOARDING_COMPLETED: 'project.onboarding_completed',
  DELETED: 'project.deleted',
} as const;

export interface ProjectEvent {
  projectId: string;
  byUserId: string | null;
}

export interface ProjectUpdatedEvent extends ProjectEvent {
  fields: string[];
}

export interface ProjectPausedEvent extends ProjectEvent {
  until: string | null;
}

/** Hires `plannedAgents` and creates the «Итоги дня» routine from this event. */
export interface ProjectOnboardingCompletedEvent extends ProjectEvent {
  plannedAgents: string[];
}

export const PROJECT_TASKS = {
  /** Resumes a project paused with `until`. */
  RESUME: 'projects.resume',
  /** Hard-deletes a soft-deleted project after the grace period. */
  PURGE: 'projects.purge',
} as const;
