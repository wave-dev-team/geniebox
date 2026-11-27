import type { z } from 'zod';

import type { AccountTx } from '../../../database/scoped-db.js';
import type { RequestMode, Risk } from '../../work/work.constants.js';

export interface RuntimeAgent {
  id: string;
  kind: 'manager' | 'agent';
  templateKey: string | null;
  /** Catalog version the agent runs on. */
  templateVersionId: string | null;
  /** Model purpose of its catalog version. */
  model: 'reasoning' | 'fast';
  /** `marketer@v3`: recorded with every model call next to the prompt version. */
  catalogTag: string | null;
  displayName: string;
  status: string;
  trustLevel: string;
  asks: string[];
  limits: Record<string, number | string>;
  customTools: string[];
}

/** Who calls a tool, for what and in which mode. Built by the runtime, never by the model. */
export interface ToolContext {
  accountId: string;
  projectId: string;
  agent: RuntimeAgent;
  taskId: string | null;
  conversationId: string | null;
  /** Assistant message that shows cards of what this turn created. */
  replyMessageId: string | null;
  /** The person whose request started the work (for journal and approvals). */
  userId: string | null;
  mode: RequestMode | null;
}

export type ToolAudience = 'manager' | 'agent';

export interface BrokerTool<TSchema extends z.ZodObject = z.ZodObject> {
  /** Stable action id: catalog id (`analytics.read`) or platform id (`assign_task`). */
  id: string;
  /** Russian title for decisions and the journal. */
  title: string;
  description: string;
  /**
   * `catalog`: an action from the agent catalog — allowed only if the agent's role has it,
   * governed by permissions and trust. `platform`: work inside Geniebox (tasks, decisions,
   * progress), allowed to every agent of the audience.
   */
  kind: 'catalog' | 'platform';
  audience: ToolAudience[];
  risk: Risk;
  /** Changes something outside Geniebox: kill switch and approval apply. */
  mutating: boolean;
  /** Ends the agent's turn (finish, propose). */
  terminal?: boolean;
  /**
   * Offered only inside this kind of work: `check` — a task that checks a proposal;
   * `conversation` — answering a person in a dialog (panel tools act as that person).
   */
  scope?: 'check' | 'conversation';
  /** Arguments schema; must be `.strict()`. */
  schema: TSchema;
  /** A catalog tool needs a connection to one of these providers. */
  providers?: string[];
  /** «Always ask» switch that forces approval for these arguments. */
  askFor?: (args: z.infer<TSchema>) => string | null;
  /** Hard limits in code; returns an error code when the call exceeds them. */
  limit?: (args: z.infer<TSchema>, agent: RuntimeAgent) => string | null;
  execute?: (context: ToolExecution, args: z.infer<TSchema>) => Promise<unknown>;
  /**
   * Runs outside the broker's transaction: tools that call services with their own
   * transactions (panel actions as the user). The call is still journaled in `tool_calls`.
   */
  standalone?: (context: ToolContext, args: z.infer<TSchema>) => Promise<unknown>;
}

/** What a tool gets when it runs: the caller context and a write transaction. */
export interface ToolExecution extends ToolContext {
  tx: AccountTx;
  /** Set when a person approved this exact call (decision). */
  approvedBy: string | null;
  decisionId: string | null;
  /** Connection chosen for a catalog tool with providers. */
  connectionId: string | null;
}

export type ToolOutcomeStatus = 'executed' | 'approval' | 'denied' | 'rejected' | 'failed' | 'blocked';

export interface ToolOutcome {
  status: ToolOutcomeStatus;
  toolId: string;
  /** Machine-readable reason, returned to the model as the tool result. */
  errorCode?: string;
  result?: unknown;
  /** Decision created for an approval-mode call. */
  decisionId?: string;
  terminal: boolean;
}

export const llmToolName = (id: string): string => id.replaceAll('.', '_');

/** Keeps the tool's own argument type inside, erases it for the registry. */
export function defineTool<TSchema extends z.ZodObject>(tool: BrokerTool<TSchema>): BrokerTool {
  return tool;
}
