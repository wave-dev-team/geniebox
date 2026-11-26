import type { Kysely } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { DB } from './types.js';

@Injectable()
export class IdentityDirectory {
  constructor(private readonly db: Kysely<DB>) {}

  find(emailKey: string) {
    // Only the global sign-in directory is read without tenant scope.
    return this.db
      .selectFrom('email_identities')
      .select(['tenant_id', 'user_id'])
      .where('email_key', '=', emailKey)
      .executeTakeFirst();
  }
}
