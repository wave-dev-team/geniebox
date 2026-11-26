import { Module } from '@nestjs/common';

import { MailModule } from '../mail/mail.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { AccountsDataModule } from './accounts-data.module.js';

@Module({
  imports: [AccountsDataModule, MailModule, ProfileModule],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}
