import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Module } from '@nestjs/common';
import { AcceptLanguageResolver, I18nModule, QueryResolver } from 'nestjs-i18n';

import { DEFAULT_LOCALE } from './locales.js';

const currentDir = dirname(fileURLToPath(import.meta.url));

@Module({
  imports: [
    I18nModule.forRoot({
      fallbackLanguage: DEFAULT_LOCALE,
      // Compiled to dist/i18n by nest-cli assets; resolves to src/i18n under ts-jest.
      loaderOptions: { path: join(currentDir, '..', '..', 'i18n'), watch: false },
      // Explicit user/account locale resolver goes first once auth lands.
      resolvers: [AcceptLanguageResolver, { use: QueryResolver, options: ['lang'] }],
      logging: false,
    }),
  ],
})
export class AppI18nModule {}
