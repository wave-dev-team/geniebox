import { z } from 'zod';

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { AccountDb } from '../../database/scoped-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { ScheduledTaskRegistry } from '../../scheduling/scheduled-task.registry.js';
import { PROJECT_EVENTS, PROJECT_TASKS, type ProjectEvent } from './events/project.events.js';
import { ProjectsRepository } from './repositories/projects.repository.js';

/** Scheduled project tasks; registered in the worker process. Both handlers are idempotent. */
@Injectable()
export class ProjectTasks implements OnModuleInit {
  private readonly logger = new Logger(ProjectTasks.name);

  constructor(
    private readonly registry: ScheduledTaskRegistry,
    private readonly accountDb: AccountDb,
    private readonly projects: ProjectsRepository,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      type: PROJECT_TASKS.RESUME,
      payloadSchema: z.object({ projectId: z.uuid(), until: z.iso.datetime({ offset: true }) }),
      handle: (payload) => this.resume(payload.projectId, new Date(payload.until)),
    });
    this.registry.register({
      type: PROJECT_TASKS.PURGE,
      payloadSchema: z.object({ projectId: z.uuid() }),
      handle: (payload) => this.purge(payload.projectId),
    });
  }

  /** Resumes only if the pause this task was created for is still the current one. */
  async resume(projectId: string, until: Date): Promise<void> {
    await this.accountDb.transaction(async (tx) => {
      const project = await this.projects.findById(tx.db, projectId, true);
      if (!project?.agents_paused || project.paused_until?.getTime() !== until.getTime()) {
        return;
      }
      await this.projects.update(tx.db, projectId, { agents_paused: false, paused_until: null });
      await this.journal.record(tx, {
        actor: { type: 'system', id: 'scheduler' },
        action: 'projects.resume',
        target: { type: 'project', id: projectId },
        args: { reason: 'pause_expired' },
        status: 'succeeded',
      });
      await this.outbox.add<ProjectEvent>(tx, {
        type: PROJECT_EVENTS.RESUMED,
        payload: { projectId, byUserId: null },
      });
    });
  }

  async purge(projectId: string): Promise<void> {
    const purged = await this.accountDb.transaction((tx) => this.projects.purge(tx.db, projectId));
    if (purged) {
      this.logger.log({ projectId }, 'Purged soft-deleted project');
    }
  }
}
