import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { ConnectionsModule } from '../connections/connections.module.js';
import { MetricsModule } from '../metrics/metrics.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [DatabaseModule, ConnectionsModule, MetricsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
