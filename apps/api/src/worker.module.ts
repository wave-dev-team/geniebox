import { Module } from '@nestjs/common';

import { CoreModule } from './core.module.js';
import { AgentsWorkerModule } from './modules/agents/agents.module.js';
import { CatalogWorkerModule } from './modules/catalog/catalog-worker.module.js';
import { ConnectionsWorkerModule } from './modules/connections/connections.module.js';
import { MailModule, MailWorkerModule } from './modules/mail/mail.module.js';
import { MetricsWorkerModule } from './modules/metrics/metrics.module.js';
import { ProjectsWorkerModule } from './modules/projects/projects.module.js';
import { RuntimeWorkerModule } from './modules/runtime/runtime.module.js';
import { StreamPublisherModule } from './modules/stream/stream.module.js';
import { OutboxWorkerModule } from './outbox/outbox-worker.module.js';
import { QueueRootModule } from './queues/queue-root.module.js';
import { SchedulingWorkerModule } from './scheduling/scheduling-worker.module.js';

/** Background process: outbox relay, queue processors (incl. mail, project tasks), scheduled-task sweeper. No HTTP. */
@Module({
  imports: [
    CoreModule,
    QueueRootModule,
    OutboxWorkerModule,
    SchedulingWorkerModule,
    MailModule,
    MailWorkerModule,
    ProjectsWorkerModule,
    ConnectionsWorkerModule,
    AgentsWorkerModule,
    StreamPublisherModule,
    RuntimeWorkerModule,
    MetricsWorkerModule,
    CatalogWorkerModule,
  ],
})
export class WorkerModule {}
