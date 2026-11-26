'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, Suspense, useEffect } from 'react';

import { Button } from '@workspace/ui/components/button';
import { Spinner } from '@workspace/ui/components/spinner';

import { useMe } from '@/entities/session';
import { routes } from '@/shared/config/routes';

function Waiting({ inline, children }: { inline?: boolean; children?: ReactNode }) {
  return (
    <div
      className={
        inline ? 'flex justify-center py-8' : 'flex min-h-svh flex-col items-center justify-center gap-3'
      }
    >
      {children ?? <Spinner className="size-5 text-muted-foreground" />}
    </div>
  );
}

function AuthGate({ children, inline }: { children: ReactNode; inline?: boolean }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const t = useTranslations('app');

  useEffect(() => {
    if (me.data !== null) return;
    const query = search.toString();
    router.replace(routes.login(pathname + (query ? `?${query}` : '')));
  }, [me.data, router, pathname, search]);

  if (me.isError) {
    return (
      <Waiting inline={inline}>
        <p role="alert">{t('connectionError')}</p>
        <Button variant="outline" onClick={() => void me.refetch()}>
          {t('retry')}
        </Button>
      </Waiting>
    );
  }

  return me.data ? children : <Waiting inline={inline} />;
}

export function RequireAuth({ children, inline }: { children: ReactNode; inline?: boolean }) {
  return (
    <Suspense fallback={<Waiting inline={inline} />}>
      <AuthGate inline={inline}>{children}</AuthGate>
    </Suspense>
  );
}
