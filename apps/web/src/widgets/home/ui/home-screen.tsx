'use client';

import { ChartNoAxesColumn, ListTodo, Shield, TrendingDown, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Button } from '@workspace/ui/components/button';

import { Composer } from './composer';

const suggestions = [
  { key: 'churn', icon: TrendingDown },
  { key: 'winBack', icon: Undo2 },
  { key: 'day', icon: ChartNoAxesColumn },
  { key: 'servers', icon: ListTodo },
] as const;

export function HomeScreen() {
  const t = useTranslations();
  const router = useRouter();
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 px-6 py-16">
      <h1 className="text-center text-3xl font-medium tracking-tight">{t('home.title')}</h1>
      <div className="w-full max-w-174">
        <div className="rounded-2xl bg-muted/60">
          <Composer onSend={() => router.push('/chat')} />
          <div className="flex items-center gap-3 px-4 py-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5 truncate">
              <Shield className="size-3.5" aria-hidden="true" />
              {t('app.brand')}
            </span>
          </div>
        </div>
      </div>
      <div className="flex max-w-174 flex-wrap justify-center gap-2">
        {suggestions.map(({ key, icon: Icon }) => (
          <Button key={key} variant="outline" render={<Link href="/chat" />} nativeButton={false}>
            <Icon />
            {t(`home.suggestions.${key}`)}
          </Button>
        ))}
      </div>
      <Link href="/marketplace" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        {t('home.noTeam')}
      </Link>
    </div>
  );
}
