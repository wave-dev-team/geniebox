'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useRef } from 'react';

import { useMe } from '@/entities/session';
import { routes, safeNextPath } from '@/shared/config/routes';

export function GuestOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get('next'));
  const wasAnonymous = useRef(false);

  useEffect(() => {
    if (me.data === null) wasAnonymous.current = true;
    if (me.data && !wasAnonymous.current) router.replace(next ?? routes.root());
  }, [me.data, router, next]);

  return children;
}
