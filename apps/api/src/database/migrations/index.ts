import type { MigrationProvider } from 'kysely/migration';

import { metricDefinitions } from './202611261250_metric-definitions.js';
import { identity } from './202611261430_identity.js';
import { managerChat } from './202611261800_manager-chat.js';
import { agentRuntime } from './202611261810_agent-runtime.js';
import { tasks } from './202611261830_tasks.js';
import { accounts } from './202611262010_accounts.js';
import { connections } from './202611262023_connections.js';
import { reports } from './202611262027_reports.js';
import { decisions } from './202611262032_decisions.js';
import { routines } from './202611262036_routines.js';
import { agentCatalog } from './202611262047_agent_catalog.js';
import { delivery } from './202611262105_delivery.js';
import { mailDelivery } from './202611262119_mail_delivery.js';

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return {
      '202611261250_metric-definitions': metricDefinitions,
      '202611261430_identity': identity,
      '202611261800_manager-chat': managerChat,
      '202611261810_agent-runtime': agentRuntime,
      '202611261830_tasks': tasks,
      '202611262010_accounts': accounts,
      '202611262023_connections': connections,
      '202611262027_reports': reports,
      '202611262032_decisions': decisions,
      '202611262036_routines': routines,
      '202611262047_agent_catalog': agentCatalog,
      '202611262105_delivery': delivery,
      '202611262119_mail_delivery': mailDelivery,
    };
  },
};
