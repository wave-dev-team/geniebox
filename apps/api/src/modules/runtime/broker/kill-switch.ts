import { Injectable } from '@nestjs/common';

import { AccountDb } from '../../../database/scoped-db.js';

export type KillSwitchState = 'open' | 'platform' | 'account' | 'project' | 'agent';

/**
 * Kill switches: the platform flag, the account flag, the project pause and
 * the agent pause. Read from Postgres on every mutating call — no cache.
 */
@Injectable()
export class KillSwitch {
  constructor(private readonly accountDb: AccountDb) {}

  async state(projectId: string, agentId: string): Promise<KillSwitchState> {
    return this.accountDb.transaction(async (tx) => {
      const platform = await tx.db
        .selectFrom('platform_flags')
        .select('enabled')
        .where('key', '=', 'agent_actions_enabled')
        .executeTakeFirst();
      if (!platform?.enabled) return 'platform';
      const account = await tx.db
        .selectFrom('accounts')
        .select(['agent_actions_enabled', 'blocked_at'])
        .where('id', '=', tx.accountId)
        .executeTakeFirst();
      // A blocked account stops every agent like the account flag.
      if (!account?.agent_actions_enabled || account.blocked_at) return 'account';
      const project = await tx.db
        .selectFrom('projects')
        .select('agents_paused')
        .where('id', '=', projectId)
        .executeTakeFirst();
      if (!project || project.agents_paused) return 'project';
      const agent = await tx.db
        .selectFrom('agents')
        .select(['status', 'deleted_at'])
        .where('id', '=', agentId)
        .executeTakeFirst();
      if (!agent || agent.deleted_at || agent.status === 'paused') return 'agent';
      return 'open';
    });
  }
}
