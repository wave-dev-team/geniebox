import { CLS_ID, type ClsService } from 'nestjs-cls';

import type { RequestContext } from '../../database/tenant-db.js';

export function runInContext<T>(
  context: ClsService<RequestContext>,
  subject: { tenantId: string; traceId: string },
  run: () => T,
) {
  return context.runWith({ tenantId: subject.tenantId, [CLS_ID]: subject.traceId }, run);
}
