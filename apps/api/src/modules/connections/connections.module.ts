import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AccountsDataModule } from '../accounts/accounts-data.module.js';
import { ConnectionsController } from './connections.controller.js';
import { ConnectionsService } from './connections.service.js';
import { MetricaProvider } from './metrica.provider.js';

@Module({
  imports: [DatabaseModule, AccountsDataModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService, MetricaProvider],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
