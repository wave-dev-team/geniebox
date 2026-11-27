import { Injectable } from '@nestjs/common';

import { ImportProposal } from '@workspace/types';
import { importProposalSchema, type ImportResult, type ImportSkeleton } from '@workspace/types';

import { AccountDb } from '../../../database/scoped-db.js';
import { LlmBudgetExceededError, LlmService } from '../../runtime/llm/llm.service.js';
import { dataBlock, untrusted } from '../../runtime/untrusted.js';
import {
  CONNECTIONS_IMPORT_PROMPT_VERSION,
  connectionsImportPrompt,
  importUserBlock,
  PROPOSE_CREDENTIALS_TOOL,
  validateProposal,
} from './connection-import.prompt.js';

export type ImportFailureCode = 'CONNECTION_IMPORT_AI_UNAVAILABLE' | 'CONNECTION_IMPORT_AI_BUDGET';

/** The model did not answer or answered something unusable: the popup falls back to rules. */
export class ConnectionsImportUnavailable extends Error {
  constructor(readonly code: ImportFailureCode) {
    super(code);
  }
}

export interface AnalyzeInput {
  projectId: string;
  skeleton: ImportSkeleton;
  clarify?: { question?: string; answer?: string; previous?: unknown };
}

/**
 * One cheap model call that turns a skeleton into assignments and questions.
 * Runs in the worker: the only place where LlmService exists, so every call is budgeted and
 * journaled in `llm_calls`.
 */
@Injectable()
export class ConnectionsImportAnalyzer {
  constructor(
    private readonly llm: LlmService,
    private readonly accountDb: AccountDb,
  ) {}

  async analyze(input: AnalyzeInput): Promise<ImportResult> {
    const project = await this.accountDb.transaction((tx) =>
      tx.db
        .selectFrom('projects')
        .select(['ai_budget_monthly'])
        .where('id', '=', input.projectId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst(),
    );
    if (!project) throw new ConnectionsImportUnavailable('CONNECTION_IMPORT_AI_UNAVAILABLE');

    const context = {
      projectId: input.projectId,
      agentId: null,
      role: 'connections.import',
      promptVersion: CONNECTIONS_IMPORT_PROMPT_VERSION,
      model: 'fast' as const,
      projectBudgetRub: project.ai_budget_monthly,
      agentBudgetRub: null,
    };
    let response;
    try {
      response = await this.llm.complete(context, {
        messages: [
          { role: 'system', content: connectionsImportPrompt() },
          {
            role: 'user',
            content: dataBlock(
              'connections-import',
              untrusted(importUserBlock(input.skeleton, input.clarify)),
            ),
          },
        ],
        tools: [PROPOSE_CREDENTIALS_TOOL],
      });
    } catch (error) {
      if (error instanceof LlmBudgetExceededError) {
        throw new ConnectionsImportUnavailable('CONNECTION_IMPORT_AI_BUDGET');
      }
      throw new ConnectionsImportUnavailable('CONNECTION_IMPORT_AI_UNAVAILABLE');
    }

    const call = response.toolCalls.find((entry) => entry.name === PROPOSE_CREDENTIALS_TOOL.name);
    if (!call) {
      await this.llm.recordInvalid(context, 'propose_credentials_missing');
      throw new ConnectionsImportUnavailable('CONNECTION_IMPORT_AI_UNAVAILABLE');
    }
    const parsed = importProposalSchema.safeParse(parseJson(call.arguments));
    if (!parsed.success) {
      await this.llm.recordInvalid(context, 'propose_credentials_invalid');
      throw new ConnectionsImportUnavailable('CONNECTION_IMPORT_AI_UNAVAILABLE');
    }
    return validateProposal(input.skeleton, parsed.data as ImportProposal);
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
