'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { cn } from '@workspace/ui/lib/utils';

const steps = ['project', 'connections', 'team', 'rules', 'ready'] as const;

export function OnboardingFrame({
  step,
  title,
  project,
  children,
  laterHref,
}: {
  step: number;
  title: string;
  project?: string;
  children: ReactNode;
  laterHref?: string;
}) {
  const t = useTranslations('onboarding');
  const app = useTranslations('app');
  return (
    <main className="min-h-svh bg-background px-4 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto grid w-full max-w-3xl gap-8">
        <header className="flex items-center justify-between gap-4">
          <span className="font-semibold">{app('brand')}</span>
          {laterHref && (
            <Link
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              href={laterHref}
            >
              {t('later')}
            </Link>
          )}
        </header>
        <ol aria-label={t('progress')} className="grid grid-cols-5 gap-1 sm:gap-3">
          {steps.map((key, index) => (
            <li
              key={key}
              aria-current={step === index + 1 ? 'step' : undefined}
              className={cn(
                'grid gap-2 text-[0.65rem] font-medium sm:text-sm',
                step === index + 1 ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              <span
                aria-hidden="true"
                className={cn('h-1.5 rounded-full', step >= index + 1 ? 'bg-primary' : 'bg-muted')}
              />
              {t(`steps.${key}`)}
            </li>
          ))}
        </ol>
        <section className="grid gap-6 rounded-xl border bg-card p-5 sm:p-8">
          <header className="grid gap-1">
            {project && <p className="break-all text-sm text-muted-foreground">{project}</p>}
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          </header>
          {children}
        </section>
      </div>
    </main>
  );
}
