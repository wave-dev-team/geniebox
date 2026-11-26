import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Hand-off between globalSetup (separate context) and test files. */
export const INFRA_FILE = join(tmpdir(), 'geniebox-e2e-infra.json');

export interface TestInfra {
  env: Record<string, string>;
  ownerUrl: string;
  adminUrl: string;
  database: string;
  containerIds: string[];
}
