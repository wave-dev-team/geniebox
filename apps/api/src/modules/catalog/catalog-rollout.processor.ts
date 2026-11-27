import type { Queue } from 'bullmq';
import { sql } from 'kysely';

import { InjectQueue, Processor } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';

import { SystemDb } from '../../database/system-db.js';
import { LoggedWorkerHost } from '../../queues/logged-worker-host.js';
import { QUEUES } from '../../queues/queues.js';
import { CatalogService } from './catalog.service.js';
import { moveAgents, type Rollout, ROLLOUT_STAGES, ROLLOUT_STEP_MS } from './catalog-rollout.js';

const SCHEDULER_ID = 'catalog-rollout';
const EVERY_MS = 10 * 60 * 1000;

/**
 * Every 10 minutes: published versions in a gradual rollout whose next step is due move the
 * next share of agents to them (10% → 50% → 100%, AG10). System role: catalog versions are
 * platform data and the version pin is the only agent column it changes.
 */
@Processor(QUEUES.CATALOG_ROLLOUT, { concurrency: 1 })
export class CatalogRolloutProcessor extends LoggedWorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly systemDb: SystemDb,
    private readonly catalog: CatalogService,
    @InjectQueue(QUEUES.CATALOG_ROLLOUT) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(SCHEDULER_ID, { every: EVERY_MS });
  }

  async process(): Promise<{ advanced: number }> {
    return this.run();
  }

  /** Public for tests: `now` moves the clock. */
  async run(now = new Date()): Promise<{ advanced: number }> {
    const due = await this.systemDb.db
      .selectFrom('agent_template_versions as v')
      .innerJoin('agent_templates as t', 't.id', 'v.template_id')
      .select(['v.id', 'v.rollout', 't.key'])
      .where('v.state', '=', 'published')
      .where(sql<boolean>`v.rollout->>'mode' = 'gradual'`)
      .where(sql<boolean>`(v.rollout->>'stage')::int < 100`)
      .where(sql<boolean>`(v.rollout->>'nextAt')::timestamptz <= ${now}`)
      .execute();
    for (const version of due) {
      const rollout = version.rollout as unknown as Rollout;
      const stage = ROLLOUT_STAGES.find((s) => s > rollout.stage) ?? 100;
      await this.systemDb.transaction(async (tx) => {
        await moveAgents(tx, version.key, version.id, stage);
        const next: Rollout = {
          mode: 'gradual',
          stage,
          nextAt: stage < 100 ? new Date(now.getTime() + ROLLOUT_STEP_MS).toISOString() : null,
        };
        await tx
          .updateTable('agent_template_versions')
          .set({ rollout: JSON.stringify(next) })
          .where('id', '=', version.id)
          .execute();
      });
    }
    if (due.length) await this.catalog.changed();
    return { advanced: due.length };
  }
}
