import type { MigrationProvider } from 'kysely/migration';

import { metricDefinitions } from './202611261250_metric-definitions.js';
import { identity } from './202611261430_identity.js';
import { managerChat } from './202611261800_manager-chat.js';
import { agentRuntime } from './202611261810_agent-runtime.js';
import { tasks } from './202611261830_tasks.js';

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return {
      '202611261250_metric-definitions': metricDefinitions,
      '202611261430_identity': identity,
      '202611261800_manager-chat': managerChat,
      '202611261810_agent-runtime': agentRuntime,
      '202611261830_tasks': tasks,
    };
  },
};
