import { type Job, UnrecoverableError } from 'bullmq';

import { Processor } from '@nestjs/bullmq';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../common/context/app-cls-store.js';
import { runInContext } from '../../common/context/run-in-context.js';
import { LoggedWorkerHost } from '../../queues/logged-worker-host.js';
import { QUEUES } from '../../queues/queues.js';
import { type CheckOutcome, connectionCheckJobSchema } from './connection-check.types.js';
import { ConnectionChecker } from './connection-checker.js';

@Processor(QUEUES.CONNECTIONS_CHECK, { concurrency: 10 })
export class ConnectionCheckProcessor extends LoggedWorkerHost {
  constructor(
    private readonly checker: ConnectionChecker,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    super();
  }

  async process(job: Job): Promise<CheckOutcome | null> {
    const parsed = connectionCheckJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(`Invalid connection check job: ${parsed.error.message}`);
    }
    const { connectionId, accountId, userId, traceId } = parsed.data;
    return runInContext(this.cls, { traceId, accountId, userId }, () =>
      this.checker.check(connectionId, userId),
    );
  }
}
