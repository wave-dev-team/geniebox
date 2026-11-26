import type { Selectable } from 'kysely';

import { localeSchema, type Profile } from '@workspace/types';

import type { UserProfiles } from '../../../database/types.js';

export function toProfile(user: Selectable<UserProfiles>, workspaceId: string): Profile {
  return {
    id: user.id,
    tenantId: workspaceId,
    email: user.email,
    name: user.name,
    locale: localeSchema.parse(user.locale),
    timeZone: user.timezone,
    emailVerified: Boolean(user.email_verified_at),
    passwordChangedAt: user.password_changed_at.toISOString(),
    hasPassword: Boolean(user.password_hash),
    connections: [],
  };
}
