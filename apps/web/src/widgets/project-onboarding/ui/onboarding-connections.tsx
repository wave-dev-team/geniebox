'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { ConnectionProvider, Project } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';

import { projectConnectionsKey, useProjectConnections } from '@/entities/project/operations';
import { listConnectionProviders, projectOperations } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { OptionSelect } from '@/shared/ui/option-select';
import { SettingsQueryStatus } from '@/shared/ui/settings-query-status';

export function OnboardingConnections({
  project,
  pending,
  onNext,
}: {
  project: Project;
  pending: boolean;
  onNext: () => void;
}) {
  const t = useTranslations('onboarding');
  const providers = useQuery({
    queryKey: ['connection-providers'],
    queryFn: ({ signal }) => listConnectionProviders(signal),
  });
  const connections = useProjectConnections(project);
  const [selected, setSelected] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const providerName = (key: string) => (t.has(`providers.${key}`) ? t(`providers.${key}`) : key);
  const provider = providers.data?.find(({ key }) => key === selected);

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">{t('connectionsHint')}</p>
      {connections.isPending || connections.isError ? (
        <SettingsQueryStatus query={connections} />
      ) : (
        <ul className="grid gap-2">
          {connections.data.map(({ id, providerKey, status, config }) => (
            <li key={id} className="grid gap-2 rounded-lg border p-3 text-sm">
              <p className="flex flex-wrap justify-between gap-2">
                <strong>{providerName(providerKey)}</strong>
                <span className="text-muted-foreground">{t(`connectionStatus.${status}`)}</span>
              </p>
              {config.public_key && (
                <>
                  <span>{t('sshHint')}</span>
                  <code className="break-all">{config.public_key}</code>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {providers.isPending || providers.isError ? (
        <SettingsQueryStatus query={providers} />
      ) : (
        <div className="grid gap-2">
          <label htmlFor="onboarding-provider" className="text-sm font-medium">
            {t('provider')}
          </label>
          <OptionSelect
            id="onboarding-provider"
            options={providers.data.map(({ key }) => key)}
            label={providerName}
            value={selected}
            onChange={setSelected}
            placeholder={t('chooseProvider')}
            disabled={pending || connecting}
          />
        </div>
      )}
      {provider && (
        <ConnectionForm
          key={provider.key}
          project={project}
          provider={provider}
          disabled={pending}
          onPending={setConnecting}
          onConnected={() => setSelected(null)}
        />
      )}
      <div className="flex justify-end">
        <Button disabled={pending || connecting} onClick={onNext}>
          {t('continue')}
        </Button>
      </div>
    </div>
  );
}

function ConnectionForm({
  provider,
  project,
  disabled,
  onConnected,
  onPending,
}: {
  provider: ConnectionProvider;
  project: Project;
  disabled: boolean;
  onConnected: () => void;
  onPending: (pending: boolean) => void;
}) {
  const t = useTranslations('onboarding');
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const [accessLevel, setAccessLevel] = useState(provider.accessLevels[0] ?? 'read');
  const save = useMutation({
    gcTime: 0,
    mutationFn: (fields: Record<string, string>) =>
      projectOperations(project.accountId, project.id).connect(provider.key, accessLevel, fields),
    onMutate: () => onPending(true),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: projectConnectionsKey(project) });
      onConnected();
    },
    onSettled: () => onPending(false),
  });
  return (
    <form
      autoComplete="off"
      className="grid gap-4 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (save.isPending || disabled) return;
        const data = new FormData(event.currentTarget);
        const fields = Object.fromEntries(
          provider.fields.flatMap(({ key }) => {
            const value = String(data.get(key) ?? '');
            return value.trim() ? [[key, value]] : [];
          }),
        );
        save.mutate(fields);
      }}
    >
      <fieldset disabled={disabled || save.isPending} className="grid gap-3">
        {provider.accessLevels.length > 1 && (
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="onboarding-access">
              {t('access')}
            </label>
            <OptionSelect
              id="onboarding-access"
              options={provider.accessLevels}
              label={(level) => t(`accessLevels.${level}`)}
              value={accessLevel}
              onChange={setAccessLevel}
              disabled={disabled || save.isPending}
            />
          </div>
        )}
        {provider.fields.map(({ key, kind, required, options, defaultValue }) => (
          <label className="grid gap-2 text-sm font-medium" key={key}>
            {t.has(`connectionFields.${key}`) ? t(`connectionFields.${key}`) : key}
            {kind === 'select' ? (
              <select
                className="h-8 rounded-md border bg-background px-3"
                name={key}
                required={required}
                defaultValue={defaultValue ?? ''}
              >
                <option value="">{t('chooseValue')}</option>
                {options?.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : (
              <Input
                name={key}
                type={
                  kind === 'secret'
                    ? 'password'
                    : kind === 'url'
                      ? 'url'
                      : kind === 'port'
                        ? 'number'
                        : 'text'
                }
                required={required}
                defaultValue={defaultValue ?? ''}
                maxLength={500}
                min={kind === 'port' ? 1 : undefined}
                max={kind === 'port' ? 65535 : undefined}
              />
            )}
          </label>
        ))}
      </fieldset>
      {save.error && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" variant="outline" disabled={disabled || save.isPending}>
          {t('connect')}
        </Button>
      </div>
    </form>
  );
}
