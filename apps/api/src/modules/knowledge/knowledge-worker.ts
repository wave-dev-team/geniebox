import { type Job, type Queue, UnrecoverableError } from 'bullmq';
import { z } from 'zod';

import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../common/context/app-cls-store.js';
import { runInContext } from '../../common/context/run-in-context.js';
import { AccountDb } from '../../database/scoped-db.js';
import { OnOutboxEvent } from '../../outbox/on-outbox-event.decorator.js';
import type { OutboxEnvelope } from '../../outbox/outbox.types.js';
import { isFinalAttempt, LoggedWorkerHost } from '../../queues/logged-worker-host.js';
import { jobId, QUEUES } from '../../queues/queues.js';
import { StreamPublisher } from '../stream/stream.publisher.js';
import {
  KNOWLEDGE_EVENTS,
  type KnowledgeNodeEvent,
  type KnowledgeSourceEvent,
} from './events/knowledge.events.js';
import { KnowledgeIndexingService } from './knowledge-indexing.service.js';
import { KnowledgeRepository } from './repositories/knowledge.repository.js';

const sourceJobSchema = z.object({
  sourceId: z.uuid(),
  projectId: z.uuid(),
  accountId: z.uuid(),
  traceId: z.string().min(1),
});

const nodeJobSchema = z.object({
  nodeId: z.uuid(),
  projectId: z.uuid(),
  accountId: z.uuid(),
  traceId: z.string().min(1),
});

/**
 * Queues knowledge work out of the request path: a person's upload or publish answers at
 * once, extraction, chunking and embeddings happen in the worker.
 */
@Injectable()
export class KnowledgeWorker {
  constructor(@InjectQueue(QUEUES.KNOWLEDGE_INDEX) private readonly queue: Queue) {}

  @OnOutboxEvent(KNOWLEDGE_EVENTS.SOURCE_UPLOADED)
  async onSourceUploaded(envelope: OutboxEnvelope<KnowledgeSourceEvent>): Promise<void> {
    await this.queue.add(
      'source',
      {
        sourceId: envelope.payload.sourceId,
        projectId: envelope.payload.projectId,
        accountId: envelope.accountId,
        traceId: envelope.traceId,
      },
      { jobId: jobId('knowledge-source', envelope.payload.sourceId) },
    );
  }

  @OnOutboxEvent(KNOWLEDGE_EVENTS.NODE_PUBLISHED)
  onNodePublished(envelope: OutboxEnvelope<KnowledgeNodeEvent>): Promise<void> {
    return this.enqueueNode(envelope);
  }

  @OnOutboxEvent(KNOWLEDGE_EVENTS.NODE_UPDATED)
  onNodeUpdated(envelope: OutboxEnvelope<KnowledgeNodeEvent>): Promise<void> {
    return this.enqueueNode(envelope);
  }

  @OnOutboxEvent(KNOWLEDGE_EVENTS.NODE_ARCHIVED)
  onNodeArchived(envelope: OutboxEnvelope<KnowledgeNodeEvent>): Promise<void> {
    return this.enqueueNode(envelope);
  }

  private async enqueueNode(envelope: OutboxEnvelope<KnowledgeNodeEvent>): Promise<void> {
    await this.queue.add(
      'node',
      {
        nodeId: envelope.payload.nodeId,
        projectId: envelope.payload.projectId,
        accountId: envelope.accountId,
        traceId: envelope.traceId,
      },
      // One job per page and trace: a burst of edits collapses into the last state.
      { jobId: jobId('knowledge-node', `${envelope.payload.nodeId}-${envelope.traceId}`) },
    );
  }
}

/**
 * Extraction, chunking and embeddings. A source that fails stays visible with the reason;
 * only the last attempt marks it failed, so an intermediate retry is not shown to a person.
 */
@Processor(QUEUES.KNOWLEDGE_INDEX, { concurrency: 2 })
export class KnowledgeIndexProcessor extends LoggedWorkerHost {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly accountDb: AccountDb,
    private readonly repo: KnowledgeRepository,
    private readonly indexing: KnowledgeIndexingService,
    private readonly stream: StreamPublisher,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'source') {
      const parsed = sourceJobSchema.safeParse(job.data);
      if (!parsed.success) throw new UnrecoverableError(`Invalid source job: ${parsed.error.message}`);
      const data = parsed.data;
      await runInContext(this.cls, { traceId: data.traceId, accountId: data.accountId }, async () => {
        try {
          await this.indexing.processSource(data.projectId, data.sourceId);
        } catch (error) {
          if (isFinalAttempt(job)) {
            await this.markFailed(data.projectId, data.sourceId, error);
          }
          throw error;
        }
      });
      return;
    }
    if (job.name === 'node') {
      const parsed = nodeJobSchema.safeParse(job.data);
      if (!parsed.success) throw new UnrecoverableError(`Invalid node job: ${parsed.error.message}`);
      const data = parsed.data;
      await runInContext(this.cls, { traceId: data.traceId, accountId: data.accountId }, () =>
        this.indexing.indexNode(data.projectId, data.nodeId),
      );
      return;
    }
    throw new UnrecoverableError(`Unknown knowledge job: ${job.name}`);
  }

  private async markFailed(projectId: string, sourceId: string, error: unknown): Promise<void> {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    await this.accountDb.transaction(async (tx) => {
      await this.repo.updateSource(tx.db, projectId, sourceId, { status: 'failed', error: message });
      tx.afterCommit(() => this.stream.publish(projectId, { type: 'knowledge.source', sourceId }));
    });
  }
}
