'use client';

import { useQuery } from '@tanstack/react-query';

import { getHealth } from '@workspace/api-client';
import { Button } from '@workspace/ui/components/button';

import { messages } from '@/i18n';

export function ApiStatus() {
  const query = useQuery({
    queryKey: ['api-health'],
    queryFn: ({ signal }) => getHealth(signal),
  });
  const available = !query.isError && query.data?.status === 'ok';

  return (
    <div className="flex min-h-12 flex-wrap items-center gap-3 text-sm text-muted-foreground">
      <span role="status">
        {query.isPending || query.isFetching
          ? messages.status.loading
          : available
            ? messages.status.ready
            : messages.status.error}
      </span>
      {!available && !query.isPending && (
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          {messages.status.retry}
        </Button>
      )}
    </div>
  );
}
