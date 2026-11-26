import { readFileSync } from 'node:fs';

import { INFRA_FILE, type TestInfra } from './infra-file.js';

// Runs before each test file's imports, so ConfigModule.forRoot sees the test env.
const infra = JSON.parse(readFileSync(INFRA_FILE, 'utf8')) as TestInfra;
Object.assign(process.env, infra.env);
