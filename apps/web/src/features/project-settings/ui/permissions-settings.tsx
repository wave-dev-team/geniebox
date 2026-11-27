'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { type PermissionMode, permissionModes } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';

import { type ProjectRef, useProjectAgents } from '@/entities/project/operations';
import { projectOperations } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { OptionSelect } from '@/shared/ui/option-select';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';
import { SettingsQueryStatus } from '@/shared/ui/settings-query-status';

export function PermissionsSettings({ project, editable }: { project: ProjectRef; editable: boolean }) {
  const t = useTranslations('projectSettings');
  const agents = useProjectAgents(project);
  const [selected, setSelected] = useState<string>();
  const options = agents.data ?? [];
  const agent = options.find(({ id }) => id === selected) ?? options[0];

  return (
    <SettingsCard title={t('tabs.permissions')}>
      {agents.isPending || agents.isError ? (
        <SettingsQueryStatus query={agents} />
      ) : agent ? (
        <>
          <SettingsRow label={t('agent')} htmlFor="permissions-agent">
            <OptionSelect
              id="permissions-agent"
              value={agent.id}
              options={options.map(({ id }) => id)}
              label={(id) => options.find((item) => item.id === id)?.displayName ?? id}
              onChange={setSelected}
            />
          </SettingsRow>
          <PermissionList key={agent.id} project={project} agentId={agent.id} editable={editable} />
        </>
      ) : (
        <p className="p-5 text-sm text-muted-foreground">{t('noAgents')}</p>
      )}
    </SettingsCard>
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
  return (
    <>
      {save.error && (
        <p className="px-5 py-3 text-sm text-destructive" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      {agent.data.permissions.length === 0 && (
        <p className="p-5 text-sm text-muted-foreground">{t('noPermissions')}</p>
      )}
      {agent.data.permissions.map(({ actionId, mode, source, locked }, index) => (
        <SettingsRow
          key={actionId}
          label={actionId}
          htmlFor={`permission-${index}`}
          hint={t(`permissionSource.${source}`)}
        >
          <OptionSelect
            id={`permission-${index}`}
            value={mode}
            options={permissionModes}
            label={(value) => t(`permissionMode.${value}`)}
            disabled={!editable || locked || save.isPending}
            onChange={(mode) => save.mutate({ actionId, mode })}
          />
          {editable && !locked && source === 'explicit' && (
            <Button
              variant="ghost"
              onClick={() => save.mutate({ actionId, mode: null })}
              disabled={save.isPending}
            >
              {t('resetPermission')}
            </Button>
          )}
        </SettingsRow>
      ))}
    </>
  );
}
