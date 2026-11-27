/**
 * Account roles: owner — everything incl. money and ownership; admin — everything
 * except ownership transfer and account deletion; tech — connections, keys, agent permissions,
 * no money and no decisions; viewer — read-only.
 */
export const ACCOUNT_ROLES = ['owner', 'admin', 'tech', 'viewer'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Roles assignable through membership management and invitations; owner only via transfer. */
export const ASSIGNABLE_ROLES = ['admin', 'tech', 'viewer'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

const RANK: Record<AccountRole, number> = { viewer: 1, tech: 2, admin: 3, owner: 4 };

/**
 * Ordering for "at least" checks. Capabilities that do not follow the ladder (money and
 * decisions are not available to tech) are checked with explicit role sets, not ranks.
 */
export function hasRoleAtLeast(actual: AccountRole, required: AccountRole): boolean {
  return RANK[actual] >= RANK[required];
}
