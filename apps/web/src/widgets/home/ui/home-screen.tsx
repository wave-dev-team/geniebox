'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChartNoAxesColumn, ListTodo, Shield, TrendingDown, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Button } from '@workspace/ui/components/button';

import { preferredProject, useProjects, useWorkspaces } from '@/entities/workspace';
import { Composer } from '@/features/manager-chat/ui/composer';
import { projectChat } from '@/shared/api';
import { routes } from '@/shared/config/routes';
import { useErrorMessage } from '@/shared/lib/api-error';

const suggestions = [
  { key: 'churn', icon: TrendingDown },
  { key: 'winBack', icon: Undo2 },
  { key: 'day', icon: ChartNoAxesColumn },
  { key: 'servers', icon: ListTodo },
] as const;

export function HomeScreen() {
  const t = useTranslations();
  const router = useRouter();
  const directory = useWorkspaces();
  const account = directory.active;
  const projects = useProjects(account?.id);
  const project = preferredProject(projects.data, account?.id);
  const client = useQueryClient();
  const errorMessage = useErrorMessage();
  const active = Boolean(project && account && account.role !== 'viewer');
  const chat = useMutation({
    mutationFn: async (message: string) => {
      if (!account || !project) throw new Error('Project required');
      const api = projectChat(account.id, project.id);
      const conversations = await api.list();
      const conversation = conversations[0] ?? (await api.create());
      await api.send(conversation.id, message);
      await client.invalidateQueries({ queryKey: ['chat', account.id, project.id] });
      router.push(routes.chat());
    },
  });
  async function send(message: string) {
    try {
      await chat.mutateAsync(message);
      return true;
    } catch {
      return false;
    }
  }
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 px-6 py-16">
      <h1 className="text-center text-3xl font-medium tracking-tight">{t('home.title')}</h1>
      <div className="w-full max-w-174">
        <div className="rounded-2xl bg-muted/60">
          <Composer home disabled={!active} sending={chat.isPending} onSend={send} />
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
      {chat.error && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(chat.error)}
        </p>
      )}
      {projects.isError && (
        <Button variant="outline" onClick={() => void projects.refetch()}>
          {t('app.retry')}
        </Button>
      )}
      {projects.isSuccess && !project && (
        <Link href="/settings" className="text-sm underline">
          {t('workspace.noProjects')}
        </Link>
      )}
      <div className="flex max-w-174 flex-wrap justify-center gap-2">
        {suggestions.map(({ key, icon: Icon }) => (
          <Button
            key={key}
            variant="outline"
            disabled={!active || chat.isPending}
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
