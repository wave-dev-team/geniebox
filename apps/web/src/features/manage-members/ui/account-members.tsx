'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import type { AssignableRole, Member, Workspace } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';

import { useMe } from '@/entities/session';
import { hasRoleAtLeast } from '@/entities/workspace';
import { membersApi } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { useConfirm } from '@/shared/ui/confirm-dialog';
import { OptionSelect } from '@/shared/ui/option-select';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';
import { SettingsQueryStatus } from '@/shared/ui/settings-query-status';

const roles: AssignableRole[] = ['viewer', 'tech', 'admin'];

export function AccountMembers({ account }: { account: Workspace }) {
  const t = useTranslations('membersSettings');
  const workspace = useTranslations('workspace');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const confirm = useConfirm();
  const { data: me } = useMe();
  const client = useQueryClient();
  const manager = hasRoleAtLeast(account.role, 'admin');
  const canSee = hasRoleAtLeast(account.role, 'tech');
  const membersKey = ['workspace-members', account.id];
  const invitesKey = ['workspace-invitations', account.id];
  const members = useQuery({
    queryKey: membersKey,
    enabled: canSee,
    queryFn: ({ signal }) => membersApi.list(account.id, signal),
  });
  const invites = useQuery({
    queryKey: invitesKey,
    enabled: manager,
    queryFn: ({ signal }) => membersApi.invitations(account.id, signal),
  });
  const change = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: membersKey });
      await client.invalidateQueries({ queryKey: invitesKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const updateWorkspaces = async (action: Promise<unknown>) => {
    await action;
    await client.invalidateQueries({ queryKey: ['workspaces'] });
  };

  async function guarded(label: string, description: string, action: () => Promise<unknown>) {
    if (await confirm({ title: label, description, confirmLabel: label })) change.mutate(action);
  }

  function memberRow(member: Member) {
    const self = me?.id === member.userId;
    const canChange =
      manager && member.role !== 'owner' && (member.role !== 'admin' || account.role === 'owner' || self);
    const canRemove = canChange && !self;
    const name = member.displayName ?? member.email;
    return (
      <SettingsRow
        key={member.userId}
        label={name}
        htmlFor={canChange ? `member-${member.userId}` : undefined}
        hint={member.displayName ? member.email : undefined}
      >
        {canChange ? (
          <OptionSelect
            id={`member-${member.userId}`}
            value={member.role}
            options={roles}
            label={(role) => workspace(role)}
            disabled={change.isPending}
            onChange={(role) => {
              if (role === 'owner') return;
              const apply = () => updateWorkspaces(membersApi.changeRole(account.id, member.userId, role));
              if (self)
                void guarded(t('changeOwnRole'), t('changeOwnRoleHint', { role: workspace(role) }), apply);
              else change.mutate(() => membersApi.changeRole(account.id, member.userId, role));
            }}
          />
        ) : (
          <span className="text-sm">{workspace(member.role)}</span>
        )}
        {canRemove && (
          <Button
            size="sm"
            variant="outline"
            disabled={change.isPending}
            onClick={() =>
              void guarded(t('remove'), t('removeHint', { name }), () =>
                membersApi.remove(account.id, member.userId),
              )
            }
          >
            {t('remove')}
          </Button>
        )}
        {account.role === 'owner' && !self && member.role !== 'owner' && (
          <Button
            size="sm"
            variant="outline"
            disabled={change.isPending}
            onClick={() =>
              void guarded(t('transfer'), t('transferHint', { name }), () =>
                updateWorkspaces(membersApi.transferOwnership(account.id, member.userId)),
              )
            }
          >
            {t('transfer')}
          </Button>
        )}
      </SettingsRow>
    );
  }

  return (
    <>
      <SettingsCard title={workspace('members')} description={t('scope', { account: account.name })}>
        {canSee &&
          (members.isPending || members.isError ? (
            <SettingsQueryStatus query={members} />
          ) : (
            members.data.map(memberRow)
          ))}
        {!canSee && <SettingsRow label={workspace('role')}>{workspace(account.role)}</SettingsRow>}
        {me && account.role !== 'owner' && (
          <SettingsRow label={t('leave')}>
            <Button
              variant="outline"
              disabled={change.isPending}
              onClick={() =>
                void guarded(t('leave'), t('leaveHint', { name: account.name }), () =>
                  updateWorkspaces(membersApi.remove(account.id, me.id)),
                )
              }
            >
              {t('leave')}
            </Button>
          </SettingsRow>
        )}
      </SettingsCard>
      {manager && (
        <SettingsCard title={t('invitations')}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (change.isPending) return;
              const form = event.currentTarget;
              const data = new FormData(form);
              change.mutate(
                () => membersApi.invite(account.id, String(data.get('email')), String(data.get('role'))),
                {
                  onSuccess: () => {
                    form.reset();
                    toast.success(workspace('sent'));
                  },
                },
              );
            }}
          >
            <SettingsRow label={workspace('invite')}>
              <Input
                name="email"
                aria-label={t('email')}
                autoComplete="email"
                placeholder="name@example.com"
                type="email"
                required
                disabled={change.isPending}
              />
              <select
                name="role"
                aria-label={workspace('role')}
                defaultValue="viewer"
                className="rounded-md border bg-background p-2 text-sm"
                disabled={change.isPending}
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {workspace(role)}
                  </option>
                ))}
              </select>
              <Button type="submit" disabled={change.isPending}>
                {workspace('send')}
              </Button>
            </SettingsRow>
          </form>
          {invites.isPending || invites.isError ? (
            <SettingsQueryStatus query={invites} />
          ) : (
            <>
              {invites.data.length === 0 && (
                <p className="p-5 text-sm text-muted-foreground">{t('noInvites')}</p>
              )}
              {invites.data.map((invitation) => (
                <SettingsRow
                  key={invitation.id}
                  label={invitation.email}
                  hint={`${workspace(invitation.role)} · ${invitation.expired ? t('expired') : t('expires', { date: format.dateTime(new Date(invitation.expiresAt), { dateStyle: 'medium' }) })}`}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={change.isPending}
                    onClick={() =>
                      void guarded(t('revoke'), t('revokeHint', { email: invitation.email }), () =>
                        membersApi.revokeInvitation(account.id, invitation.id),
                      )
                    }
                  >
                    {t('revoke')}
                  </Button>
                </SettingsRow>
              ))}
            </>
          )}
        </SettingsCard>
      )}
    </>
  );
}
