import { execFileSync } from 'node:child_process';

import { loadDbToolingEnv } from '../src/config/env.js';

// Types are generated from a migrated database; --check fails CI if the committed file drifted.
const OUT_FILE = 'src/database/types.ts';
const check = process.argv.includes('--check');
const env = loadDbToolingEnv();

const args = [
  'kysely-codegen',
  '--dialect',
  'postgres',
  '--url',
  env.DATABASE_OWNER_URL,
  '--exclude-pattern',
  'kysely_migration*',
  '--out-file',
  OUT_FILE,
];
if (check) {
  args.push('--verify');
}

try {
  execFileSync('pnpm', ['exec', ...args], { stdio: 'inherit' });
} catch {
  console.error(check ? `${OUT_FILE} is out of date: run pnpm db:codegen` : 'Codegen failed');
  process.exitCode = 1;
}
