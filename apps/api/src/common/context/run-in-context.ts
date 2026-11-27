import { CLS_ID, type ClsService } from 'nestjs-cls';

import type { AppClsStore } from './app-cls-store.js';

export interface JobContext {
  traceId: string;
  accountId?: string | null;
  userId?: string | null;
}

/** Opens an isolated CLS context for non-HTTP work (queue jobs, relay loops, tests). */
export function runInContext<T>(
  cls: ClsService<AppClsStore>,
  context: JobContext,
  fn: () => Promise<T>,
): Promise<T> {
  return cls.run({ ifNested: 'override' }, async () => {
    cls.set(CLS_ID, context.traceId);
    if (context.accountId) {
      cls.set('accountId', context.accountId);
    }
    if (context.userId) {
      cls.set('userId', context.userId);
    }
    return fn();
  });
}
