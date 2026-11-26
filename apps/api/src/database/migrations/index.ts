import type { MigrationProvider } from 'kysely/migration';

import { metricDefinitions } from './202611261250_metric-definitions.js';
import { identity } from './202611261430_identity.js';

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return { '202611261250_metric-definitions': metricDefinitions, '202611261430_identity': identity };
  },
};
