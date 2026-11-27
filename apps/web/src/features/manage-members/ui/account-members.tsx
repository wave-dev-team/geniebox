'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EllipsisVertical, ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';

import type { AssignableRole, Member, Workspace, WorkspaceRole } from '@workspace/types';
import { Avatar, AvatarFallback } from '@workspace/ui/components/avatar';
import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import { Input } from '@workspace/ui/components/input';

import { useMe } from '@/entities/session';
import { hasRoleAtLeast } from '@/entities/workspace';
import { membersApi } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { initials } from '@/shared/lib/initials';
import { useConfirm } from '@/shared/ui/confirm-dialog';
import { OptionSelect } from '@/shared/ui/option-select';
import { SettingsCard } from '@/shared/ui/settings-card';
import { SettingsQueryStatus } from '@/shared/ui/settings-query-status';

const roleOrder: WorkspaceRole[] = ['owner', 'admin', 'tech', 'viewer'];
const roles: AssignableRole[] = ['admin', 'tech', 'viewer'];

export function AccountMembers({ account }: { account: Workspace }) {
  const t = useTranslations('membersSettings');
  const workspace = useTranslations('workspace');
  const common = useTranslations('common');
  const [inviting, setInviting] = useState(false);
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

  const leave =
    me && account.role !== 'owner'
      ? () =>
          void guarded(t('leave'), t('leaveHint', { name: account.name }), () =>
            updateWorkspaces(membersApi.remove(account.id, me.id)),
          )
      : undefined;

  function memberRow(member: Member) {
    const self = me?.id === member.userId;
    const canChange =
      manager && member.role !== 'owner' && (member.role !== 'admin' || account.role === 'owner' || self);
    const canRemove = canChange && !self;
    const canTransfer = account.role === 'owner' && !self && member.role !== 'owner';
    const name = member.displayName ?? member.email;
    return (
      <MemberRow
        key={member.userId}
        name={name}
        description={member.email}
        self={self ? t('you') : undefined}
      >
        {canChange ? (
          <OptionSelect
            ariaLabel={`${workspace('role')} · ${name}`}
            value={member.role}
            options={roles}
            label={(role) => workspace(role)}
            className="w-full bg-background sm:w-44"
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
          <span className="text-sm text-muted-foreground">{workspace(member.role)}</span>
        )}
        <MemberActions label={t('actions', { name })} disabled={change.isPending}>
          {canTransfer && (
            <DropdownMenuItem
              onClick={() =>
                void guarded(t('transfer'), t('transferHint', { name }), () =>
                  updateWorkspaces(membersApi.transferOwnership(account.id, member.userId)),
                )
              }
            >
              {t('transfer')}
            </DropdownMenuItem>
          )}
          {canRemove && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                void guarded(t('remove'), t('removeHint', { name }), () =>
                  membersApi.remove(account.id, member.userId),
                )
              }
            >
              {t('remove')}
            </DropdownMenuItem>
          )}
          {self && leave && (
            <DropdownMenuItem variant="destructive" onClick={leave}>
              {t('leave')}
            </DropdownMenuItem>
          )}
        </MemberActions>
      </MemberRow>
    );
  }

  return (
    <>
      <SettingsCard
        title={workspace('members')}
        description={t('scope')}
        footer={manager ? <Button onClick={() => setInviting(true)}>{t('invite')}</Button> : undefined}
      >
        {!canSee ? (
          <div className="p-5">
            <div className="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm">
              <ShieldAlert className="size-4 shrink-0" />
              {t('viewerDenied')}
            </div>
            {leave && (
              <Button className="mt-3" variant="outline" disabled={change.isPending} onClick={leave}>
                {t('leave')}
              </Button>
            )}
          </div>
        ) : members.isPending || members.isError ? (
          <SettingsQueryStatus query={members} />
        ) : (
          <ul className="flex flex-col gap-2 p-3">
            {[...members.data]
              .sort(
                (a, b) =>
                  roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) ||
                  new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime(),
              )
              .map(memberRow)}
            {invites.data?.map((invitation) => (
              <MemberRow
                key={invitation.id}
                name={invitation.email}
                description={t(invitation.expired ? 'expired' : 'pending')}
              >
                <span className="text-sm text-muted-foreground">{workspace(invitation.role)}</span>
                <MemberActions label={t('actions', { name: invitation.email })} disabled={change.isPending}>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() =>
                      void guarded(t('revoke'), t('revokeHint', { email: invitation.email }), () =>
                        membersApi.revokeInvitation(account.id, invitation.id),
                      )
                    }
                  >
                    {t('revoke')}
                  </DropdownMenuItem>
                </MemberActions>
              </MemberRow>
            ))}
          </ul>
        )}
        {manager && (invites.isPending || invites.isError) && <SettingsQueryStatus query={invites} />}
      </SettingsCard>
      <SettingsCard title={t('rolesTitle')}>
        <dl>
          {roleOrder.map((role) => (
            <div
              key={role}
              className="grid gap-1 border-b px-5 py-3 text-sm last:border-b-0 sm:grid-cols-[14rem_1fr]"
            >
              <dt className="font-medium">{workspace(role)}</dt>
              <dd className="text-muted-foreground">{t(`roleDescription.${role}`)}</dd>
            </div>
          ))}
        </dl>
      </SettingsCard>
      {manager && (
        <Dialog
          open={inviting}
          onOpenChange={(open) => {
            if (!change.isPending) setInviting(open);
          }}
        >
          <DialogContent>
            <form
              className="grid gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                if (change.isPending) return;
                const data = new FormData(event.currentTarget);
                change.mutate(
                  () =>
                    membersApi.invite(account.id, String(data.get('email')).trim(), String(data.get('role'))),
                  {
                    onSuccess: () => {
                      setInviting(false);
                      toast.success(workspace('sent'));
                    },
                  },
                );
              }}
            >
              <DialogHeader>
                <DialogTitle>{t('inviteTitle')}</DialogTitle>
                <DialogDescription>{t('inviteDescription')}</DialogDescription>
              </DialogHeader>
              <label className="grid gap-2 text-sm font-medium">
                {t('email')}
                <Input
                  name="email"
                  autoComplete="email"
                  placeholder="name@example.com"
                  type="email"
                  maxLength={254}
                  required
                  disabled={change.isPending}
                />
              </label>
              <fieldset className="grid gap-2" disabled={change.isPending}>
                <legend className="mb-2 text-sm font-medium">{workspace('role')}</legend>
                {roles.map((role) => (
                  <label
                    key={role}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm has-checked:border-ring"
                  >
                    <input
                      className="mt-0.5 accent-primary"
                      type="radio"
                      name="role"
                      value={role}
                      defaultChecked={role === 'tech'}
                      required
                    />
                    <span className="grid gap-0.5">
                      <span className="font-medium">{workspace(role)}</span>
                      <span className="text-muted-foreground">{t(`roleSummary.${role}`)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={change.isPending}
                  onClick={() => setInviting(false)}
                >
                  {common('cancel')}
                </Button>
                <Button type="submit" disabled={change.isPending}>
                  {t('sendInvitation')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function MemberRow({
  name,
  description,
  self,
  children,
}: {
  name: string;
  description: string;
  self?: string;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/50 p-3">
      <Avatar className="size-9 shrink-0 rounded-lg">
        <AvatarFallback className="rounded-lg">{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-32 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">
          {name}
          {self && <span className="font-normal text-muted-foreground"> · {self}</span>}
        </span>
        <span className="truncate text-sm text-muted-foreground">{description}</span>
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2">{children}</div>
    </li>
  );
}

function MemberActions({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled: boolean;
  children: ReactNode[] | ReactNode;
}) {
  if (!(Array.isArray(children) ? children.some(Boolean) : children)) {
    return <span className="size-7" aria-hidden="true" />;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        disabled={disabled}
        render={<Button variant="ghost" size="icon-sm" />}
      >
        <EllipsisVertical />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
