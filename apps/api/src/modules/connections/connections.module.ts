import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE_JOB_OPTIONS, QUEUES } from '../../queues/queues.js';
import { SecretsModule, SecretsOpenerModule } from '../../secrets/secrets.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ConnectionCheckProcessor } from './connection-check.processor.js';
import {
  CHECK_QUEUE_EVENTS,
  checkQueueEventsProvider,
  ConnectionCheckRunner,
} from './connection-check.runner.js';
import { ConnectionChecker } from './connection-checker.js';
import { ConnectionSecrets } from './connection-secrets.js';
import {
  ConnectionLinkController,
  ConnectionProvidersController,
  ConnectionsController,
} from './connections.controller.js';
import { ConnectionsService } from './connections.service.js';
import { ConnectionsMaintenance } from './connections-maintenance.js';
import { ProviderHttp } from './providers/provider-http.js';
import { ConnectionsRepository } from './repositories/connections.repository.js';

const checkQueue = BullModule.registerQueue({
  name: QUEUES.CONNECTIONS_CHECK,
  defaultJobOptions: QUEUE_JOB_OPTIONS[QUEUES.CONNECTIONS_CHECK],
});

/** API side: stores sealed secrets (public KEK only) and asks the worker to check them. */
@Module({
  imports: [AccountsModule, ProjectsModule, SecretsModule, checkQueue],
  controllers: [ConnectionProvidersController, ConnectionsController, ConnectionLinkController],
  providers: [ConnectionsService, ConnectionsRepository, ConnectionCheckRunner, checkQueueEventsProvider],
  exports: [CHECK_QUEUE_EVENTS, ConnectionsService],
})
export class ConnectionsModule {}

/** Worker side: opens secrets (private KEK), runs checks and maintenance. */
@Module({
  imports: [
    SecretsOpenerModule,
    checkQueue,
    BullModule.registerQueue({
      name: QUEUES.CONNECTIONS_MAINTENANCE,
      defaultJobOptions: QUEUE_JOB_OPTIONS[QUEUES.CONNECTIONS_MAINTENANCE],
    }),
  ],
  providers: [
    ConnectionChecker,
    ConnectionCheckProcessor,
    ConnectionsMaintenance,
    ConnectionsRepository,
    ConnectionSecrets,
    ProviderHttp,
  ],
  exports: [ConnectionSecrets, ProviderHttp],
})
export class ConnectionsWorkerModule {}
