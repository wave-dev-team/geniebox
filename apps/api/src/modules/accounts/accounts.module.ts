import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module.js';
import { AccountContext } from './account-context.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { AccountAccessGuard } from './guards/account-access.guard.js';
import { InvitationAcceptanceController, InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';
import { AccountsRepository } from './repositories/accounts.repository.js';
import { InvitationsRepository } from './repositories/invitations.repository.js';
import { MembersRepository } from './repositories/members.repository.js';

@Module({
  imports: [UsersModule],
  controllers: [AccountsController, MembersController, InvitationsController, InvitationAcceptanceController],
  providers: [
    AccountsService,
    MembersService,
    InvitationsService,
    AccountsRepository,
    MembersRepository,
    InvitationsRepository,
    AccountAccessGuard,
    AccountContext,
  ],
  // MembersRepository: AccountAccessGuard is used by routes of other modules.
  exports: [
    AccountsService,
    AccountAccessGuard,
    AccountContext,
    MembersRepository,
    InvitationsService,
    MembersService,
  ],
})
export class AccountsModule {}
