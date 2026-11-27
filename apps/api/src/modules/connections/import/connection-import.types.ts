import { z } from 'zod';

import type { ImportSkeleton } from '@workspace/types';

/** One import job carries a skeleton only: names, labels and shapes, never values. */
export const connectionsImportJobSchema = z
  .object({
    accountId: z.uuid(),
    projectId: z.uuid(),
    traceId: z.string().min(1),
    mode: z.enum(['analyze', 'clarify']),
    skeleton: z.object({}).passthrough(),
    /** Clarify only: the question the person answers, and their words. */
    question: z.string().max(300).optional(),
    answer: z.string().max(500).optional(),
    previous: z.object({}).passthrough().optional(),
  })
  .strict();

export type ConnectionsImportJob = z.infer<typeof connectionsImportJobSchema>;

export interface ImportGroupInput {
  providerKey: string;
  accessLevel?: 'read' | 'read_write';
  fields: Record<string, string>;
}

export type ImportOutcome = 'created' | 'replaced' | 'skipped' | 'unchanged' | 'failed';

export interface ImportGroupResult {
  providerKey: string;
  outcome: ImportOutcome;
  connectionId: string | null;
  status: string | null;
  masked: string | null;
  error: { code: string; field?: string } | null;
}

export type { ImportSkeleton };
