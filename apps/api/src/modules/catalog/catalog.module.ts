import { Global, Module } from '@nestjs/common';

import { CatalogService } from './catalog.service.js';

/** The agent catalog for every process (API, worker): in-memory, refreshed on change. */
@Global()
@Module({
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
