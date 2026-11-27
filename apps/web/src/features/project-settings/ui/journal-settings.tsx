'use client';

import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { type JournalFilters, journalPeriods, journalResults } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';

import { type ProjectRef, useProjectAgents, useProjectConnections } from '@/entities/project/operations';
import { projectOperations } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { OptionSelect } from '@/shared/ui/option-select';
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
    <section className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="font-semibold">{t('tabs.journal')}</h2>
          <p className="text-sm text-muted-foreground">{t('journalDescription')}</p>
        </div>
        <Button
          className="shrink-0"
          variant="outline"
          disabled={download.isPending}
          onClick={() => download.mutate()}
        >
          <Download />
          {t('downloadCsv')}
        </Button>
      </header>
      <div className="flex flex-wrap gap-2">
        <OptionSelect
          ariaLabel={t('period')}
          className="w-auto min-w-32"
          options={journalPeriods}
          value={filters.period}
          label={(period) => t(`journalPeriod.${period}`)}
          onChange={(period) => setFilters({ ...filters, period })}
        />
        <OptionSelect
          ariaLabel={t('agent')}
          className="w-auto min-w-32"
          options={[all, ...(agents.data ?? []).map(({ id }) => id)]}
          value={filters.agentId ?? all}
          label={(id) => (id === all ? t('allAgents') : agentName(id))}
          onChange={(id) => setFilters({ ...filters, agentId: id === all ? undefined : id })}
        />
        <OptionSelect
          ariaLabel={t('connection')}
          className="w-auto min-w-32"
          options={[all, ...(connections.data ?? []).map(({ id }) => id)]}
          value={filters.connectionId ?? all}
          label={(id) => (id === all ? t('allConnections') : connectionName(id))}
          onChange={(id) => setFilters({ ...filters, connectionId: id === all ? undefined : id })}
        />
        <OptionSelect
          ariaLabel={t('result')}
          className="w-auto min-w-32"
          options={[all, ...journalResults] as const}
          value={filters.result ?? all}
          label={(result) => t(`journalResult.${result}`)}
          onChange={(result) => setFilters({ ...filters, result: result === all ? undefined : result })}
        />
      </div>
      {agents.isError && <SettingsQueryStatus query={agents} />}
      {connections.isError && <SettingsQueryStatus query={connections} />}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b text-left">
              {(['journalTime', 'agent', 'journalTool', 'journalDetails', 'result'] as const).map(
                (column) => (
                  <th className="px-4 py-3 font-medium" key={column} scope="col">
                    {t(column)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y">
            {(journal.isPending || (journal.isError && !entries.length)) && (
              <tr>
                <td colSpan={5}>
                  <SettingsQueryStatus query={journal} />
                </td>
              </tr>
            )}
            {!journal.isPending && !journal.isError && !entries.length && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  {t('journalEmpty')}
                </td>
              </tr>
            )}
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  <time dateTime={entry.at}>
                    {format.dateTime(new Date(entry.at), { dateStyle: 'short', timeStyle: 'short' })}
                  </time>
                </td>
                <td className="px-4 py-3">{agentName(entry.agentId)}</td>
                <td className="px-4 py-3 font-mono text-xs">{entry.toolId}</td>
                <td className="max-w-56 px-4 py-3 break-words text-muted-foreground">
                  {entry.details}
                  {entry.connectionId && (
                    <span className="block text-xs">{connectionName(entry.connectionId)}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {t.has(`journalStatus.${entry.status}`) ? t(`journalStatus.${entry.status}`) : entry.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {journal.isFetchNextPageError && (
        <p className="px-5 py-3 text-sm text-destructive" role="alert">
          {errorMessage(journal.error)}
        </p>
      )}
      {journal.hasNextPage && (
        <div className="self-center">
          <Button
            variant="outline"
            disabled={journal.isFetching}
            onClick={() => void journal.fetchNextPage()}
          >
            {t('loadMore')}
          </Button>
        </div>
      )}
    </section>
  );
}
