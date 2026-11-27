import { type Job, UnrecoverableError } from 'bullmq';

import { Processor } from '@nestjs/bullmq';
import { ClsService } from 'nestjs-cls';

import { importSkeletonSchema } from '@workspace/types';

import type { AppClsStore } from '../../../common/context/app-cls-store.js';
import { runInContext } from '../../../common/context/run-in-context.js';
import { LoggedWorkerHost } from '../../../queues/logged-worker-host.js';
import { QUEUES } from '../../../queues/queues.js';
import { connectionsImportJobSchema } from './connection-import.types.js';
import { ConnectionsImportUnavailable } from './connections-import.analyzer.js';
import { ConnectionsImportAnalyzer } from './connections-import.analyzer.js';

/** The model call happens here: the worker owns the LLM client and the AI budget. */
@Processor(QUEUES.CONNECTIONS_IMPORT, { concurrency: 4 })
export class ConnectionsImportProcessor extends LoggedWorkerHost {
  constructor(
    private readonly analyzer: ConnectionsImportAnalyzer,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const parsed = connectionsImportJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(`Invalid connections import job: ${parsed.error.message}`);
    }
    const data = parsed.data;
    const skeleton = importSkeletonSchema.safeParse(data.skeleton);
    if (!skeleton.success) {
      throw new UnrecoverableError(`Invalid connections import skeleton: ${skeleton.error.message}`);
    }
    try {
      return await runInContext(
        this.cls,
        {
          traceId: data.traceId,
          accountId: data.accountId,
        },
        () =>
          this.analyzer.analyze({
            projectId: data.projectId,
            skeleton: skeleton.data,
            clarify:
              data.mode === 'clarify'
                ? { question: data.question, answer: data.answer, previous: data.previous }
                : undefined,
          }),
      );
    } catch (error) {
      if (error instanceof ConnectionsImportUnavailable) {
        throw new UnrecoverableError(error.code);
      }
      throw error;
    }
  }
}
