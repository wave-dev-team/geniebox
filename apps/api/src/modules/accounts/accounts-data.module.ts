import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { JournalModule } from '../../journal/journal.module.js';
import { AccountsRepository } from './accounts.repository.js';

@Module({
  imports: [DatabaseModule, JournalModule],
  providers: [AccountsRepository],
  exports: [AccountsRepository],
})
export class AccountsDataModule {}
