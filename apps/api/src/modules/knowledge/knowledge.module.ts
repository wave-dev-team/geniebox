import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE_JOB_OPTIONS, QUEUES } from '../../queues/queues.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { BlobStore } from './blob-store.js';
import { embeddingProvider, EmbeddingsService } from './embeddings.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';
import { KnowledgeIndexingService } from './knowledge-indexing.service.js';
import { KnowledgeIndexProcessor, KnowledgeWorker } from './knowledge-worker.js';
import { KnowledgeRepository } from './repositories/knowledge.repository.js';

/** Storage, embeddings and repositories shared by the API, the worker and the agent tools. */
@Module({
  providers: [KnowledgeRepository, BlobStore, embeddingProvider, EmbeddingsService, KnowledgeIndexingService],
  exports: [KnowledgeRepository, BlobStore, EmbeddingsService, KnowledgeIndexingService],
})
export class KnowledgeDataModule {}

/** Person-facing API of the knowledge base. */
@Module({
  imports: [AccountsModule, ProjectsModule, KnowledgeDataModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
})
export class KnowledgeModule {}

/** Extraction and indexing of sources and published pages (worker only). */
@Module({
  imports: [
    KnowledgeDataModule,
    BullModule.registerQueue({
      name: QUEUES.KNOWLEDGE_INDEX,
      defaultJobOptions: QUEUE_JOB_OPTIONS[QUEUES.KNOWLEDGE_INDEX],
    }),
  ],
  providers: [KnowledgeWorker, KnowledgeIndexProcessor],
})
export class KnowledgeWorkerModule {}
