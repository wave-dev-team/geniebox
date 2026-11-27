'use client';

import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { type JournalFilters, journalPeriods, journalResults } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';

import { type ProjectRef, useProjectAgents, useProjectConnections } from '@/entities/project/operations';
import { projectOperations } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { OptionSelect } from '@/shared/ui/option-select';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';
import { SettingsQueryStatus } from '@/shared/ui/settings-query-status';

const all = 'all';

export function JournalSettings({ project }: { project: ProjectRef }) {
  const t = useTranslations('projectSettings');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const agents = useProjectAgents(project);
  const connections = useProjectConnections(project);
  const [filters, setFilters] = useState<JournalFilters>({ period: 'today' });
  const api = projectOperations(project.accountId, project.id);
  const journal = useInfiniteQuery({
    queryKey: ['project-journal', project.accountId, project.id, filters],
    queryFn: ({ pageParam, signal }) => api.journal(filters, pageParam ?? undefined, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const download = useMutation({
    mutationFn: () => api.journalCsv(filters),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'geniebox-journal.csv';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const agentName = (id: string) => agents.data?.find((agent) => agent.id === id)?.displayName ?? id;
  const connectionName = (id: string) =>
    connections.data?.find((connection) => connection.id === id)?.name ?? id;
  const entries = journal.data?.pages.flatMap(({ items }) => items) ?? [];

  return (
    <SettingsCard
      title={t('tabs.journal')}
      action={
        <Button variant="outline" disabled={download.isPending} onClick={() => download.mutate()}>
          {t('downloadCsv')}
        </Button>
      }
    >
      <SettingsRow label={t('period')} htmlFor="journal-period">
        <OptionSelect
          id="journal-period"
          options={journalPeriods}
          value={filters.period}
          label={(period) => t(`journalPeriod.${period}`)}
          onChange={(period) => setFilters({ ...filters, period })}
        />
      </SettingsRow>
      <SettingsRow label={t('agent')} htmlFor="journal-agent">
        <OptionSelect
          id="journal-agent"
          options={[all, ...(agents.data ?? []).map(({ id }) => id)]}
          value={filters.agentId ?? all}
          label={(id) => (id === all ? t('allAgents') : agentName(id))}
          onChange={(id) => setFilters({ ...filters, agentId: id === all ? undefined : id })}
        />
      </SettingsRow>
      <SettingsRow label={t('connection')} htmlFor="journal-connection">
        <OptionSelect
          id="journal-connection"
          options={[all, ...(connections.data ?? []).map(({ id }) => id)]}
          value={filters.connectionId ?? all}
          label={(id) => (id === all ? t('allConnections') : connectionName(id))}
          onChange={(id) => setFilters({ ...filters, connectionId: id === all ? undefined : id })}
        />
      </SettingsRow>
      <SettingsRow label={t('result')} htmlFor="journal-result">
        <OptionSelect
          id="journal-result"
          options={[all, ...journalResults] as const}
          value={filters.result ?? all}
          label={(result) => t(`journalResult.${result}`)}
          onChange={(result) => setFilters({ ...filters, result: result === all ? undefined : result })}
        />
      </SettingsRow>
      {agents.isError && <SettingsQueryStatus query={agents} />}
      {connections.isError && <SettingsQueryStatus query={connections} />}
      {(journal.isPending || (journal.isError && !entries.length)) && <SettingsQueryStatus query={journal} />}
      {!journal.isPending && !journal.isError && !entries.length && (
        <p className="p-5 text-sm text-muted-foreground">{t('journalEmpty')}</p>
      )}
      <ul className="divide-y">
        {entries.map((entry) => (
          <li className="grid gap-1 px-5 py-3 text-sm" key={entry.id}>
            <div className="flex flex-wrap justify-between gap-x-4">
              <strong className="break-all font-medium">{entry.toolId}</strong>
              <time className="text-muted-foreground" dateTime={entry.at}>
                {format.dateTime(new Date(entry.at), { dateStyle: 'short', timeStyle: 'short' })}
              </time>
            </div>
            <p className="break-words">{entry.details}</p>
            <span className="break-words text-muted-foreground">
              {agentName(entry.agentId)}
              {entry.connectionId ? ` · ${connectionName(entry.connectionId)}` : ''} ·{' '}
              {t.has(`journalStatus.${entry.status}`) ? t(`journalStatus.${entry.status}`) : entry.status}
            </span>
          </li>
        ))}
      </ul>
      {journal.isFetchNextPageError && (
        <p className="px-5 py-3 text-sm text-destructive" role="alert">
          {errorMessage(journal.error)}
        </p>
      )}
      {journal.hasNextPage && (
        <div className="p-5">
          <Button
            variant="outline"
            disabled={journal.isFetching}
            onClick={() => void journal.fetchNextPage()}
          >
            {t('loadMore')}
          </Button>
        </div>
      )}
    </SettingsCard>
  );
}
