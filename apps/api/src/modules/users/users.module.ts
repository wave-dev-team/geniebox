import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { JournalModule } from '../../journal/journal.module.js';
import { UsersRepository } from './repositories/users.repository.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [DatabaseModule, JournalModule],
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class UsersDataModule {}

@Module({
  imports: [UsersDataModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
