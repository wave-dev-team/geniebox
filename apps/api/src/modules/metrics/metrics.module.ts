import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE_JOB_OPTIONS, QUEUES } from '../../queues/queues.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { ConnectionsWorkerModule } from '../connections/connections.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { WorkDataModule } from '../work/work.module.js';
import { ActivityService } from './activity.service.js';
import { MetricCollector } from './metric-collector.js';
import { MetricsController, ResultsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';
import { MetricsCollectProcessor, MetricsMaintenance, MetricsWorker } from './metrics-worker.js';
import { MetricsRepository } from './repositories/metrics.repository.js';
import { ResultsRepository } from './repositories/results.repository.js';
import { ResultsService } from './results.service.js';

const REPOSITORIES = [MetricsRepository, ResultsRepository];

/** Repositories shared by the API, the metrics worker and the agent runtime. */
@Module({ providers: REPOSITORIES, exports: REPOSITORIES })
export class MetricsDataModule {}

/** Official metrics, summary, results, journal of the public API. */
@Module({
  imports: [AccountsModule, ProjectsModule, WorkDataModule, MetricsDataModule],
  controllers: [MetricsController, ResultsController],
  providers: [MetricsService, ResultsService, ActivityService],
  exports: [MetricsService, ResultsService, ActivityService],
})
export class MetricsModule {}

/** Collection of metrics, event partitions, defaults and due checks (worker only). */
@Module({
  imports: [
    MetricsDataModule,
    WorkDataModule,
    ConnectionsWorkerModule,
    BullModule.registerQueue(
      {
        name: QUEUES.METRICS_COLLECT,
        defaultJobOptions: QUEUE_JOB_OPTIONS[QUEUES.METRICS_COLLECT],
      },
      {
        name: QUEUES.METRICS_MAINTENANCE,
        defaultJobOptions: QUEUE_JOB_OPTIONS[QUEUES.METRICS_MAINTENANCE],
      },
    ),
  ],
  providers: [MetricCollector, MetricsWorker, MetricsCollectProcessor, MetricsMaintenance],
})
export class MetricsWorkerModule {}
