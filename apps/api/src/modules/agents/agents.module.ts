import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { AgentsController } from './agents.controller.js';
import { AgentsRepository } from './agents.repository.js';
import { AgentsService } from './agents.service.js';

@Module({
  imports: [DatabaseModule, CatalogModule, ReportsModule],
  controllers: [AgentsController],
  providers: [AgentsRepository, AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
