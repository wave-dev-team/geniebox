/** Outbox events and queue jobs of the knowledge base. */

export const KNOWLEDGE_EVENTS = {
  SOURCE_UPLOADED: 'knowledge.source_uploaded',
  SOURCE_PROCESSED: 'knowledge.source_processed',
  SOURCE_FAILED: 'knowledge.source_failed',
  NODE_CREATED: 'knowledge.node_created',
  NODE_UPDATED: 'knowledge.node_updated',
  NODE_PUBLISHED: 'knowledge.node_published',
  NODE_ARCHIVED: 'knowledge.node_archived',
  PROPOSAL_RESOLVED: 'knowledge.proposal_resolved',
} as const;

export interface KnowledgeSourceEvent {
  projectId: string;
  sourceId: string;
  byUserId: string | null;
}

export interface KnowledgeSourceFailedEvent extends KnowledgeSourceEvent {
  error: string;
}

export interface KnowledgeNodeEvent {
  projectId: string;
  nodeId: string;
  byUserId: string | null;
}

export interface KnowledgeProposalResolvedEvent {
  projectId: string;
  proposalId: string;
  status: 'accepted' | 'rejected';
}
