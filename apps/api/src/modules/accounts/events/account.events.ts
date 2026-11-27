import type { AccountRole } from '../../../common/auth/account-role.js';

export const ACCOUNT_EVENTS = {
  CREATED: 'account.created',
  UPDATED: 'account.updated',
  MEMBER_ADDED: 'account.member_added',
  MEMBER_ROLE_CHANGED: 'account.member_role_changed',
  MEMBER_REMOVED: 'account.member_removed',
  OWNERSHIP_TRANSFERRED: 'account.ownership_transferred',
  INVITATION_CREATED: 'account.invitation_created',
  INVITATION_REVOKED: 'account.invitation_revoked',
} as const;

export interface AccountCreatedEvent {
  accountId: string;
  ownerUserId: string;
}

export interface MemberEvent {
  accountId: string;
  userId: string;
  role: AccountRole;
  byUserId: string;
}

export interface MemberRoleChangedEvent extends MemberEvent {
  previousRole: AccountRole;
}

export interface OwnershipTransferredEvent {
  accountId: string;
  fromUserId: string;
  toUserId: string;
}

export interface InvitationEvent {
  accountId: string;
  invitationId: string;
  role: AccountRole;
  byUserId: string;
}
