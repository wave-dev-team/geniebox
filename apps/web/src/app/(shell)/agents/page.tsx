'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { type Agent, type UpdateAgent, updateAgentSchema } from '@workspace/types';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';
import { Skeleton } from '@workspace/ui/components/skeleton';
import { Textarea } from '@workspace/ui/components/textarea';

import { useMe } from '@/entities/session';
import { agentsApi } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';

function AgentCard({
  agent,
  scope,
}: {
  agent: Agent;
  scope: readonly [string | undefined, string | undefined];
}) {
  const t = useTranslations('agentCatalog');
  const format = useFormatter();
  const client = useQueryClient();
  const errorMessage = useErrorMessage();
  const [editing, setEditing] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const key = ['agent-versions', ...scope, agent.id] as const;
  const history = useInfiniteQuery({
    queryKey: key,
    enabled: showVersions,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) => agentsApi.history(agent.id, pageParam, signal),
    getNextPageParam: (page) => page.next ?? undefined,
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['agents', ...scope] });
    void client.invalidateQueries({ queryKey: key });
    void client.invalidateQueries({ queryKey: ['tasks', ...scope, 'agents'] });
  };
  const onError = (error: Error) => {
    refresh();
    toast.error(errorMessage(error));
  };
  const save = useMutation({
    mutationFn: (input: UpdateAgent) => agentsApi.update(agent.id, input),
    onSuccess: () => {
      refresh();
      setEditing(false);
    },
    onError,
  });
  const restore = useMutation({
    mutationFn: (revision: number) => agentsApi.restore(agent.id, revision, agent.revision),
    onSuccess: () => {
      setEditing(false);
      refresh();
      toast.success(t('restored'));
    },
    onError,
  });
  const busy = save.isPending || restore.isPending;

  return (
    <SettingsCard
      title={agent.name}
      description={agent.catalogKey ? t(agent.catalogKey) : undefined}
      action={
        <Badge variant={agent.enabled ? 'default' : 'secondary'}>
          {t(agent.enabled ? 'active' : 'paused')}
        </Badge>
      }
    >
      <SettingsRow label={t('version', { revision: agent.revision })}>
        <Button variant="outline" disabled={busy} onClick={() => save.mutate({ enabled: !agent.enabled })}>
          {t(agent.enabled ? 'pause' : 'activate')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setEditing(!editing)}>
          {t(editing ? 'cancel' : 'edit')}
        </Button>
        <Button variant="ghost" onClick={() => setShowVersions(!showVersions)}>
          {t('history')}
        </Button>
      </SettingsRow>
      {editing ? (
        <form
          key={agent.revision}
          className="flex flex-col gap-3 border-t px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const input = updateAgentSchema.safeParse({
              name: form.get('name'),
              instructions: form.get('instructions'),
              expectedRevision: agent.revision,
            });
            if (!input.success) {
              toast.error(t('invalid'));
              return;
            }
            save.mutate(input.data);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {t('name')}
            <Input name="name" maxLength={80} defaultValue={agent.name} required />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('instructions')}
            <Textarea
              name="instructions"
              maxLength={3000}
              rows={6}
              defaultValue={agent.instructions}
              required
            />
          </label>
          <Button type="submit" className="self-start" disabled={busy}>
            {t('save')}
          </Button>
        </form>
      ) : null}
      {showVersions ? (
        <div className="border-t">
          {history.isPending ? (
            <Skeleton className="m-4 h-14" />
          ) : history.isError ? (
            <Button className="m-4" variant="outline" onClick={() => void history.refetch()}>
              {t('retry')}
            </Button>
          ) : (
            <>
              {history.data.pages
                .flatMap(({ items }) => items)
                .map((version) => (
                  <SettingsRow
                    key={version.revision}
                    label={t('version', { revision: version.revision })}
                    hint={format.dateTime(new Date(version.createdAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  >
                    <details className="min-w-0 text-sm">
                      <summary className="cursor-pointer">{t('instructions')}</summary>
                      <p className="mt-1 break-words whitespace-pre-wrap">{version.instructions}</p>
                    </details>
                    {version.revision !== agent.revision ? (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => restore.mutate(version.revision)}
                      >
                        {t('restore')}
                      </Button>
                    ) : null}
                  </SettingsRow>
                ))}
              {history.hasNextPage ? (
                <Button
                  className="m-4"
                  variant="outline"
                  disabled={history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}
                >
                  {t('more')}
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </SettingsCard>
  );
}

export default function AgentsPage() {
  const t = useTranslations('agentCatalog');
  const { data: me } = useMe();
  const scope = [me?.tenantId, me?.id] as const;
  const agents = useQuery({
    queryKey: ['agents', ...scope],
    queryFn: ({ signal }) => agentsApi.list(signal),
    enabled: Boolean(me),
  });

  return (
    <main className="mx-auto flex w-full max-w-230 flex-col gap-6 px-6 py-10">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      {agents.isPending ? (
        <Skeleton className="h-36" />
      ) : agents.isError ? (
        <Button variant="outline" className="self-start" onClick={() => void agents.refetch()}>
          {t('retry')}
        </Button>
      ) : (
        agents.data.map((agent) => <AgentCard key={agent.id} scope={scope} agent={agent} />)
      )}
    </main>
  );
}
