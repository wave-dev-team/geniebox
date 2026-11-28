'use client';

import { useTranslations } from 'next-intl';

import { BrandLogo } from '@/shared/ui/brand-logo';

/** Centered single-column layout of sign-in, sign-up and recovery screens (G06). */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations('auth');
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-90 flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <BrandLogo className="mb-2 size-10 text-foreground" />
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle ? <p className="text-sm text-balance text-muted-foreground">{subtitle}</p> : null}
        </div>
        {children}
        <p className="border-t pt-4 text-center text-xs text-balance text-muted-foreground">
          {t('hackathonNotice')}
        </p>
      </div>
    </main>
  );
}
