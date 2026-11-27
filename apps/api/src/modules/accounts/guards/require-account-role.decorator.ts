import { type CustomDecorator, SetMetadata } from '@nestjs/common';

import type { AccountRole } from '../../../common/auth/account-role.js';

export const ACCOUNT_ROLE_KEY = 'accountRole';

/** Minimum role in the `:accountId` account; without it any member passes. */
export const RequireAccountRole = (role: AccountRole): CustomDecorator => SetMetadata(ACCOUNT_ROLE_KEY, role);
