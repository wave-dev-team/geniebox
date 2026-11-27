export const AGENT_EVENTS = {
  HIRED: 'agent.hired',
  UPDATED: 'agent.updated',
  RULES_UPDATED: 'agent.rules_updated',
  PERMISSIONS_UPDATED: 'agent.permissions_updated',
  CONNECTIONS_UPDATED: 'agent.connections_updated',
  PAUSED: 'agent.paused',
  RESUMED: 'agent.resumed',
  FIRED: 'agent.fired',
} as const;

export interface AgentEvent {
  projectId: string;
  agentId: string;
  byUserId: string | null;
}

export const AGENT_TASKS = {
  /** Resumes an agent paused with `until`. */
  RESUME: 'agents.resume',
  /** Ends the probation period: the agent becomes «работает». */
  PROBATION_END: 'agents.probation_end',
} as const;
