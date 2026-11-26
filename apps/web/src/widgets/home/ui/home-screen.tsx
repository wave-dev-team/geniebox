'use client';

import { ChartNoAxesColumn, ListTodo, Shield, TrendingDown, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Button } from '@workspace/ui/components/button';

import { useManagerChat } from '@/features/manager-chat/model/use-manager-chat';
import { Composer } from '@/features/manager-chat/ui/composer';
import { routes } from '@/shared/config/routes';

const suggestions = [
  { key: 'churn', icon: TrendingDown },
  { key: 'winBack', icon: Undo2 },
  { key: 'day', icon: ChartNoAxesColumn },
  { key: 'servers', icon: ListTodo },
] as const;

export function HomeScreen() {
  const t = useTranslations();
  const router = useRouter();
  const chat = useManagerChat();
  const active = Boolean(chat.history.data?.enabled) && !chat.pending;
  async function send(message: string) {
    if (!(await chat.send(message))) return false;
    router.push(routes.chat());
    return true;
  }
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 px-6 py-16">
      <h1 className="text-center text-3xl font-medium tracking-tight">{t('home.title')}</h1>
      <div className="w-full max-w-174">
        <div className="rounded-2xl bg-muted/60">
          <Composer home disabled={!active} sending={chat.sending} onSend={send} />
          <div className="flex items-center gap-3 px-4 py-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5 truncate">
              <Shield className="size-3.5" aria-hidden="true" />
              {t('app.brand')}
            </span>
            <Link href={routes.chat()} className="ml-auto hover:underline">
              {t('managerChat.open')}
            </Link>
          </div>
        </div>
      </div>
      {chat.sendError && (
        <p role="alert" className="text-sm text-destructive">
          {t(`managerChat.${chat.sendError}`)}
        </p>
      )}
      {chat.history.isError && (
        <p role="alert" className="text-sm text-muted-foreground">
          {t('managerChat.loadError')}
        </p>
      )}
      {chat.history.data && !chat.history.data.enabled && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('managerChat.unavailable')}
        </p>
      )}
      <div className="flex max-w-174 flex-wrap justify-center gap-2">
        {suggestions.map(({ key, icon: Icon }) => (
          <Button
            key={key}
            variant="outline"
            disabled={!active || chat.sending}
            onClick={() => void send(t(`home.suggestions.${key}`))}
          >
            <Icon />
            {t(`home.suggestions.${key}`)}
          </Button>
        ))}
      </div>
      <Link href="/agents" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        {t('home.openAgents')}
      </Link>
    </div>
  );
}
