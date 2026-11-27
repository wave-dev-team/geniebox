'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@workspace/ui/components/button';
import { Skeleton } from '@workspace/ui/components/skeleton';

import { useErrorMessage } from '@/shared/lib/api-error';

export function SettingsQueryStatus({
  query,
}: {
  query: { isPending: boolean; error: Error | null; refetch: () => unknown };
}) {
  const t = useTranslations('common');
  const errorMessage = useErrorMessage();
  return (
    <div className="p-5">
      {query.error ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <span className="text-sm text-destructive">{errorMessage(query.error)}</span>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : query.isPending ? (
        <Skeleton className="h-12" aria-label={t('loading')} />
      ) : null}
    </div>
  );
}
