import { randomUUID } from 'node:crypto';

import type { Queue } from 'bullmq';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { IMPORT_LIMITS, importResultSchema, importSkeletonSchema } from '@workspace/types';

import type { AppClsStore } from '../../../common/context/app-cls-store.js';
import { QUEUES } from '../../../queues/queues.js';
import { ProjectContext } from '../../projects/project-context.js';
import { CONNECTION_ERRORS, ConnectionException } from '../connections.errors.js';
import { ConnectionsService } from '../connections.service.js';
import type { ClarifyImportDto, ImportConnectionsDto } from '../dto/connection-import.dto.js';
import type { ConnectionsImportJob, ImportGroupResult } from './connection-import.types.js';

/**
 * API side of the import: validates the skeleton, enqueues the analysis for the worker and
 * answers with a job id. Saving goes through ConnectionsService, the model is not involved.
 */
@Injectable()
export class ConnectionsImportService {
  constructor(
    @InjectQueue(QUEUES.CONNECTIONS_IMPORT) private readonly queue: Queue<ConnectionsImportJob>,
    private readonly projectContext: ProjectContext,
    private readonly connections: ConnectionsService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  analyze(skeleton: unknown): Promise<{ jobId: string }> {
    return this.enqueue('analyze', skeleton);
  }

  clarify(dto: ClarifyImportDto): Promise<{ jobId: string }> {
    return this.enqueue('clarify', dto.skeleton, {
      question: dto.question,
      answer: dto.answer,
      previous: dto.previous,
    });
  }

  async status(jobId: string): Promise<{
    status: 'queued' | 'running' | 'done' | 'failed';
    result: Record<string, unknown> | null;
    error: string | null;
  }> {
    const actor = this.projectContext.actor();
    const job = await this.queue.getJob(jobId);
    if (!job || job.data.projectId !== actor.projectId || job.data.accountId !== actor.accountId) {
      throw new ConnectionException(CONNECTION_ERRORS.CONNECTION_IMPORT_JOB_NOT_FOUND);
    }
    const state = await job.getState();
    if (state === 'completed') {
      const result = importResultSchema.safeParse(job.returnvalue);
      return {
        status: result.success ? 'done' : 'failed',
        result: result.success ? result.data : null,
        error: result.success ? null : CONNECTION_ERRORS.CONNECTION_IMPORT_AI_UNAVAILABLE,
      };
    }
    if (state === 'failed') {
      return {
        status: 'failed',
        result: null,
        error: this.failureCode(job.failedReason),
      };
    }
    return { status: state === 'active' ? 'running' : 'queued', result: null, error: null };
  }

  import(dto: ImportConnectionsDto): Promise<ImportGroupResult[]> {
    return this.connections.importMany(dto.groups, dto.mode ?? 'skip');
  }

  private async enqueue(
    mode: 'analyze' | 'clarify',
    raw: unknown,
    extra: Partial<Pick<ConnectionsImportJob, 'question' | 'answer' | 'previous'>> = {},
  ): Promise<{ jobId: string }> {
    const actor = this.projectContext.actor();
    const skeleton = importSkeletonSchema.safeParse(raw);
    if (!skeleton.success) throw new ConnectionException(CONNECTION_ERRORS.CONNECTION_IMPORT_INVALID);
    // The skeleton has no values, so its size is the shape of the buffer, not a secret.
    if (Buffer.byteLength(JSON.stringify(skeleton.data), 'utf8') > IMPORT_LIMITS.bytes) {
      throw new ConnectionException(CONNECTION_ERRORS.CONNECTION_IMPORT_TOO_LARGE);
    }
    const jobId = randomUUID();
    await this.queue.add(
      mode,
      {
        accountId: actor.accountId,
        projectId: actor.projectId,
        traceId: this.cls.getId() ?? jobId,
        mode,
        skeleton: skeleton.data,
        ...extra,
      },
      { jobId },
    );
    return { jobId };
  }

  /** Only our own codes reach the UI; anything else means the analysis did not happen. */
  private failureCode(reason: string | undefined): string {
    return reason === CONNECTION_ERRORS.CONNECTION_IMPORT_AI_BUDGET
      ? CONNECTION_ERRORS.CONNECTION_IMPORT_AI_BUDGET
      : CONNECTION_ERRORS.CONNECTION_IMPORT_AI_UNAVAILABLE;
  }
}
