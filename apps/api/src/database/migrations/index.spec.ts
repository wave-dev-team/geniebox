import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrations } from './index.js';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('migrations registry', () => {
  it('registers every migration file in the folder', () => {
    const files = readdirSync(currentDir)
      .filter((file) => /^\d{12}_.+\.ts$/.test(file) && !file.endsWith('.spec.ts'))
      .map((file) => file.replace(/\.ts$/, ''))
      .sort();
    expect(Object.keys(migrations).sort()).toEqual(files);
  });
});
