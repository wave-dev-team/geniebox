import { cp } from 'node:fs/promises';

await cp(new URL('../src/i18n/', import.meta.url), new URL('../dist/i18n/', import.meta.url), {
  recursive: true,
});
