'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import {
  metricsReportInputSchema,
  type ReportDecisionInput,
  type ReportWithDecision,
} from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';
import { Skeleton } from '@workspace/ui/components/skeleton';

import { useMe } from '@/entities/session';
import { useWorkspaces } from '@/entities/workspace';
import { connectionsApi, metricsApi, reportsApi } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';

function ReportCard({
  report,
  onDecision,
  busy,
}: {
  report: ReportWithDecision;
  onDecision?: (decision: ReportDecisionInput) => void;
  busy: boolean;
}) {
  const t = useTranslations('analytics');
  const format = useFormatter();
  const number = (value: number) => format.number(value, { maximumFractionDigits: 2 });
  const label = report.metric === report.label ? t(report.metric) : report.label;
  return (
    <SettingsCard title={report.title} description={label}>
      <SettingsRow label={t('baseline')} hint={`${report.baseline.from} — ${report.baseline.to}`}>
        <span className="text-sm tabular-nums">{number(report.before)}</span>
      </SettingsRow>
      <SettingsRow label={t('comparison')} hint={`${report.comparison.from} — ${report.comparison.to}`}>
        <span className="text-sm tabular-nums">{number(report.after)}</span>
      </SettingsRow>
      <SettingsRow label={t('change')}>
        <span className="text-sm tabular-nums">
          {report.change === null ? t('zeroBaseline') : `${number(report.change)}%`}
        </span>
      </SettingsRow>
      {report.criterion ? (
        <SettingsRow
          label={t('criterion')}
          hint={`${t(report.criterion.direction)} ${number(report.criterion.target)}%`}
        >
          <span className="text-sm">
            {t(report.criterionMet === null ? 'unknown' : report.criterionMet ? 'reached' : 'missed')}
          </span>
        </SettingsRow>
      ) : null}
      <SettingsRow label={t('source')} hint={report.sampled ? t('sampled') : undefined}>
        {report.sourceUrl ? (
          <a
            className="text-sm underline underline-offset-4"
            href={report.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t('metricSource')}
          </a>
        ) : (
          <span className="text-sm">{t('synthetic')}</span>
        )}
      </SettingsRow>
      {report.decision ? (
        <SettingsRow label={t('decision')} hint={report.decision.rationale || undefined}>
          <span className="text-sm">{t(report.decision.outcome)}</span>
          {report.decision.taskId ? (
            <Link
              className="text-sm underline underline-offset-4"
              href={`/tasks?task=${report.decision.taskId}`}
            >
              {t('openTask')}
            </Link>
          ) : null}
        </SettingsRow>
      ) : onDecision ? (
        <form
          className="flex flex-col gap-3 px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const outcome = data.get('outcome');
            const rationale = data.get('rationale');
            if ((outcome === 'followUp' || outcome === 'close') && typeof rationale === 'string') {
              onDecision({ outcome, rationale });
            }
          }}
        >
          <label className="text-sm font-medium" htmlFor={`decision-${report.id}`}>
            {t('decision')}
          </label>
          <select
            id={`decision-${report.id}`}
            name="outcome"
            required
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">{t('chooseDecision')}</option>
            <option value="followUp">{t('followUp')}</option>
            <option value="close">{t('close')}</option>
          </select>
          <Input aria-label={t('rationale')} placeholder={t('rationale')} name="rationale" maxLength={1000} />
          <Button type="submit" disabled={busy} className="self-start" variant="outline">
            {t('saveDecision')}
          </Button>
        </form>
      ) : null}
    </SettingsCard>
  );
}

export default function ReportsPage() {
  const t = useTranslations('analytics');
  const { data: me } = useMe();
  const { data: workspaces } = useWorkspaces();
  const canDecide = workspaces?.workspaces.find(({ id }) => id === workspaces.activeId)?.role === 'owner';
  const scope = [me?.tenantId, me?.id] as const;
  const key = ['metrics-reports', ...scope] as const;
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const connections = useQuery({
    queryKey: ['connections', ...scope],
    queryFn: ({ signal }) => connectionsApi.list(signal),
    enabled: Boolean(me),
  });
  const metrics = useQuery({
    queryKey: ['metric-definitions', ...scope],
    queryFn: ({ signal }) => metricsApi.list(signal),
    enabled: Boolean(me),
  });
  const reports = useInfiniteQuery({
    queryKey: key,
    enabled: Boolean(me),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => reportsApi.list(pageParam, signal),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const create = useMutation({
    mutationFn: reportsApi.create,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key });
      toast.success(t('reportSaved'));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const decide = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReportDecisionInput }) => reportsApi.decide(id, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: ['tasks', ...scope] });
      toast.success(t('decisionSaved'));
    },
    onError: (error) => {
      void client.invalidateQueries({ queryKey: key });
      toast.error(errorMessage(error));
    },
  });

  return (
    <main className="mx-auto flex w-full max-w-200 flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('reports')}</h1>
        <Link className="text-sm underline underline-offset-4" href="/metrics">
          {t('metrics')}
        </Link>
      </div>
      {connections.isPending || metrics.isPending ? (
        <Skeleton className="h-40" />
      ) : connections.isError || metrics.isError ? (
        <Button
          className="self-start"
          variant="outline"
          onClick={() => {
            void connections.refetch();
            void metrics.refetch();
          }}
        >
          {t('retry')}
        </Button>
      ) : connections.data?.metrica ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const value = (name: string) => String(data.get(name) ?? '');
            const request = metricsReportInputSchema.safeParse({
              title: value('title'),
              metric: value('metric'),
              baseline: { from: value('baselineFrom'), to: value('baselineTo') },
              comparison: { from: value('comparisonFrom'), to: value('comparisonTo') },
              ...(value('target') && {
                criterion: { target: Number(value('target')), direction: value('direction') },
              }),
            });
            if (!request.success) {
              toast.error(t('invalidReport'));
              return;
            }
            create.mutate(request.data);
          }}
        >
          <SettingsCard
            title={t('create')}
            description={t('periodHelp')}
            footer={
              <Button disabled={create.isPending} type="submit">
                {t('compare')}
              </Button>
            }
          >
            <SettingsRow htmlFor="report-title" label={t('title')}>
              <Input id="report-title" name="title" maxLength={120} required />
            </SettingsRow>
            <SettingsRow htmlFor="report-metric" label={t('metric')}>
              <select
                id="report-metric"
                name="metric"
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                {metrics.data?.map(({ key: metric, label }) => (
                  <option value={metric} key={metric}>
                    {label === metric ? t(metric) : label}
                  </option>
                ))}
              </select>
            </SettingsRow>
            {(['baseline', 'comparison'] as const).map((period) => (
              <SettingsRow key={period} label={t(period)}>
                <Input
                  aria-label={`${t(period)}, ${t('from')}`}
                  className="min-w-0"
                  name={`${period}From`}
                  type="date"
                  required
                />
                <Input
                  aria-label={`${t(period)}, ${t('to')}`}
                  className="min-w-0"
                  name={`${period}To`}
                  type="date"
                  required
                />
              </SettingsRow>
            ))}
            <SettingsRow htmlFor="report-criterion" label={t('criterion')} hint={t('criterionHelp')}>
              <select
                aria-label={t('criterionDirection')}
                name="direction"
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="atLeast">{t('atLeast')}</option>
                <option value="atMost">{t('atMost')}</option>
              </select>
              <Input
                id="report-criterion"
                className="min-w-0"
                name="target"
                type="number"
                min={-100}
                max={10000}
                step="any"
              />
            </SettingsRow>
          </SettingsCard>
        </form>
      ) : (
        <SettingsCard title={t('create')} description={t('needsConnection')}>
          <SettingsRow label={t('metricSource')}>
            <Link className="text-sm underline" href="/connections">
              {t('connections')}
            </Link>
          </SettingsRow>
        </SettingsCard>
      )}
      <h2 className="text-lg font-semibold">{t('history')}</h2>
      {reports.isPending ? (
        <Skeleton className="h-40" />
      ) : reports.isError ? (
        <Button className="self-start" variant="outline" onClick={() => void reports.refetch()}>
          {t('retry')}
        </Button>
      ) : (
        <>
          {reports.data.pages[0]?.reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : null}
          {reports.data.pages
            .flatMap((page) => page.reports)
            .map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                busy={decide.isPending}
                onDecision={canDecide ? (input) => decide.mutate({ id: report.id, input }) : undefined}
              />
            ))}
          {reports.hasNextPage ? (
            <Button
              className="self-start"
              variant="outline"
              disabled={reports.isFetchingNextPage}
              onClick={() => void reports.fetchNextPage()}
            >
              {t('more')}
            </Button>
          ) : null}
        </>
      )}
    </main>
  );
}
