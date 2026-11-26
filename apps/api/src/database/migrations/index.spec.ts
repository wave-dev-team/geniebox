import { readdir } from 'node:fs/promises';

import { migrationProvider } from './index.js';

it('registers every migration file', async () => {
  const files = await readdir(new URL('.', import.meta.url));
  const names = files.filter((file) => /^\d{12}_.+\.ts$/.test(file)).map((file) => file.slice(0, -3));
  expect(Object.keys(await migrationProvider.getMigrations()).sort()).toEqual(names.sort());
});
