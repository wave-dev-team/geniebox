'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Lock, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { type PermissionMode, permissionModes } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs';

import { type ProjectRef, useProjectAgents } from '@/entities/project/operations';
import { projectOperations } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { SettingsQueryStatus } from '@/shared/ui/settings-query-status';

export function PermissionsSettings({ project, editable }: { project: ProjectRef; editable: boolean }) {
  const t = useTranslations('projectSettings');
  const agents = useProjectAgents(project);
  const [selected, setSelected] = useState<string>();
  const options = agents.data ?? [];
  const agent = options.find(({ id }) => id === selected) ?? options[0];

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 className="font-semibold">{t('tabs.permissions')}</h2>
        <p className="text-sm text-muted-foreground">{t('permissionsDescription')}</p>
      </header>
      {agents.isPending || agents.isError ? (
        <SettingsQueryStatus query={agents} />
      ) : agent ? (
        <>
          <div role="group" aria-label={t('agent')} className="flex flex-wrap gap-2">
            {options.map(({ id, displayName }) => (
              <Button
                key={id}
                size="sm"
                variant={agent.id === id ? 'secondary' : 'outline'}
                aria-pressed={agent.id === id}
                onClick={() => setSelected(id)}
              >
                <Bot />
                {displayName}
              </Button>
            ))}
          </div>
          <PermissionList key={agent.id} project={project} agentId={agent.id} editable={editable} />
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border px-5 py-10 text-center">
          <span className="rounded-lg bg-muted p-2">
            <Bot className="size-5" />
          </span>
          <h3 className="text-sm font-medium">{t('noAgents')}</h3>
          <p className="text-sm text-muted-foreground">{t('permissionsEmptyHint')}</p>
        </div>
      )}
    </section>
  );
}

function PermissionList({
  project,
  agentId,
  editable,
}: {
  project: ProjectRef;
  agentId: string;
  editable: boolean;
}) {
  const t = useTranslations('projectSettings');
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const api = projectOperations(project.accountId, project.id);
  const queryKey = ['project-agent-permissions', project.accountId, project.id, agentId];
  const agent = useQuery({ queryKey, queryFn: ({ signal }) => api.agent(agentId, signal) });
  const save = useMutation({
    mutationFn: ({ actionId, mode }: { actionId: string; mode: PermissionMode | null }) =>
      api.setPermission(agentId, actionId, mode),
    onSuccess: (updated) => client.setQueryData(queryKey, updated),
  });

  if (agent.isPending || agent.isError) return <SettingsQueryStatus query={agent} />;
  const permissions = [...agent.data.permissions].sort((a, b) => Number(a.locked) - Number(b.locked));
  if (!permissions.length) {
    return <p className="rounded-xl border px-5 py-6 text-sm text-muted-foreground">{t('noPermissions')}</p>;
  }

  return (
    <>
      {save.error && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <ul className="divide-y rounded-xl border">
        {permissions.map(({ actionId, mode, source, locked }) => (
          <li key={actionId} className="flex flex-col gap-3 px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="font-mono text-sm font-medium break-all">{actionId}</span>
                <span className="text-xs text-muted-foreground">{t(`permissionSource.${source}`)}</span>
              </div>
              {locked ? (
                <Lock
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-label={t('permissionSource.system')}
                />
              ) : editable && source === 'explicit' ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('resetPermission')}
                  title={t('resetPermission')}
                  onClick={() => save.mutate({ actionId, mode: null })}
                  disabled={save.isPending}
                >
                  <RotateCcw />
                </Button>
              ) : null}
            </div>
            <Tabs value={mode} onValueChange={(mode: PermissionMode) => save.mutate({ actionId, mode })}>
              <TabsList
                aria-label={actionId}
                className="max-w-full flex-wrap group-data-horizontal/tabs:h-auto"
              >
                {permissionModes.map((value) => (
                  <TabsTrigger key={value} value={value} disabled={!editable || locked || save.isPending}>
                    {t(`permissionMode.${value}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </li>
        ))}
      </ul>
    </>
  );
}
