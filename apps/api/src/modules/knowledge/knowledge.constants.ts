/** Knowledge base vocabulary shared by the API, the worker and the agent tools. */

export const KNOWLEDGE_NODE_KINDS = ['folder', 'page'] as const;
export type KnowledgeNodeKind = (typeof KNOWLEDGE_NODE_KINDS)[number];

export const KNOWLEDGE_STATUSES = ['draft', 'published', 'archived'] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export const KNOWLEDGE_SOURCE_KINDS = ['upload', 'text'] as const;
export type KnowledgeSourceKind = (typeof KNOWLEDGE_SOURCE_KINDS)[number];

export const KNOWLEDGE_SOURCE_STATUSES = ['processing', 'ready', 'failed', 'archived'] as const;
export type KnowledgeSourceStatus = (typeof KNOWLEDGE_SOURCE_STATUSES)[number];

export const KNOWLEDGE_PROPOSAL_KINDS = ['create', 'edit', 'gap'] as const;
export type KnowledgeProposalKind = (typeof KNOWLEDGE_PROPOSAL_KINDS)[number];

export const KNOWLEDGE_PROPOSAL_STATUSES = ['open', 'accepted', 'rejected'] as const;
export type KnowledgeProposalStatus = (typeof KNOWLEDGE_PROPOSAL_STATUSES)[number];

/** Formats a person can import today. Everything else is rejected before it reaches the worker. */
export const KNOWLEDGE_FILE_FORMATS = ['md', 'txt', 'csv', 'xlsx'] as const;
export type KnowledgeFileFormat = (typeof KNOWLEDGE_FILE_FORMATS)[number];

export const KNOWLEDGE_FORMAT_MIME: Record<KnowledgeFileFormat, readonly string[]> = {
  md: ['text/markdown', 'text/plain'],
  txt: ['text/plain'],
  csv: ['text/csv', 'text/plain', 'application/csv'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
};

export const KNOWLEDGE_LIMITS = {
  title: 120,
  body: 200_000,
  sourceTitle: 200,
  /** Chunks returned to an agent in one search: the context budget is a product rule. */
  searchChunks: 5,
  /** Characters per knowledge tool response, leaving room for citation metadata. */
  readBody: 1_200,
  /** Rows rendered into one page of a spreadsheet; the rest is a separate page. */
  sheetRows: 120,
  sheetColumns: 40,
  /** Section characters per extracted block before it is split further. */
  sectionChars: 8_000,
} as const;

export const KNOWLEDGE_ACTIONS = {
  NODE_CREATE: 'knowledge.node.create',
  NODE_UPDATE: 'knowledge.node.update',
  NODE_PUBLISH: 'knowledge.node.publish',
  NODE_ARCHIVE: 'knowledge.node.archive',
  NODE_RESTORE: 'knowledge.node.restore',
  SOURCE_UPLOAD: 'knowledge.source.upload',
  SOURCE_RETRY: 'knowledge.source.retry',
  PROPOSAL_ACCEPT: 'knowledge.proposal.accept',
  PROPOSAL_REJECT: 'knowledge.proposal.reject',
  SEARCH: 'knowledge.search',
} as const;
