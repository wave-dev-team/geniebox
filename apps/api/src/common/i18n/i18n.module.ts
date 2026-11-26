import { fileURLToPath } from 'node:url';

import { Module } from '@nestjs/common';
import { AcceptLanguageResolver, I18nModule } from 'nestjs-i18n';

@Module({
  imports: [
    I18nModule.forRoot({
      fallbackLanguage: 'ru',
      loaderOptions: { path: fileURLToPath(new URL('../../i18n', import.meta.url)) },
      resolvers: [AcceptLanguageResolver],
    }),
  ],
})
export class AppI18nModule {}
