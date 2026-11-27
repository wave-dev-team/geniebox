import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE_JOB_OPTIONS, QUEUES } from '../../queues/queues.js';
import { CatalogRolloutProcessor } from './catalog-rollout.processor.js';

/** Worker side of the catalog: the gradual rollout of published versions. */
@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUES.CATALOG_ROLLOUT,
      defaultJobOptions: QUEUE_JOB_OPTIONS[QUEUES.CATALOG_ROLLOUT],
    }),
  ],
  providers: [CatalogRolloutProcessor],
})
export class CatalogWorkerModule {}
