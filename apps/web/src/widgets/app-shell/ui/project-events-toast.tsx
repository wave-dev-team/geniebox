'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useRef } from 'react';
import { toast } from 'sonner';

import { useActiveProject } from '@/entities/project/use-active-project';
import { projectChat } from '@/shared/api';
import { useWorkStream, type WorkStreamEvent } from '@/shared/api/use-work-stream';
import { useErrorMessage } from '@/shared/lib/api-error';

function ProjectEventSubscriber({
  account,
  project,
  isInChat,
}: {
  account: string;
  project: string;
  isInChat: boolean;
}) {
  const t = useTranslations('eventToasts');
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const seen = useRef(new Set<string>());
  const lastInsightAt = useRef(0);
  const inChatRef = useRef(isInChat);
  inChatRef.current = isInChat;

  const handleEvent = useCallback(
    async (event: WorkStreamEvent) => {
      const api = projectChat(account, project);

      if (event.type === 'decision.updated') {
        const key = `decision:${event.decisionId}`;
        if (seen.current.has(key) || inChatRef.current) return;
        try {
          const decision = await api.decision(event.decisionId);
          if (decision.status && decision.status !== 'pending') return;
          seen.current.add(key);
          const toastId = toast(decision.title, {
            description: decision.meta ?? decision.effect ?? undefined,
            duration: Infinity,
            action: {
              label: decision.yesLabel ?? t('approve'),
              onClick: () => {
                void api
                  .acceptDecision(event.decisionId)
                  .then(() => {
                    toast.success(t('decisionApproved'));
                    void client.invalidateQueries({ queryKey: ['project-tasks', account, project] });
                  })
                  .catch((err: unknown) => toast.error(errorMessage(err)))
                  .finally(() => toast.dismiss(toastId));
              },
            },
            cancel: {
              label: t('reject'),
              onClick: () => {
                void api
                  .rejectDecision(event.decisionId)
                  .then(() => {
                    toast.info(t('decisionRejected'));
                    void client.invalidateQueries({ queryKey: ['project-tasks', account, project] });
                  })
                  .catch((err: unknown) => toast.error(errorMessage(err)))
                  .finally(() => toast.dismiss(toastId));
              },
            },
          });
        } catch {
          // Ignore transient fetch failures for background notifications.
        }
        return;
      }

      if (event.type === 'task.updated') {
        try {
          const task = await api.task(event.taskId);
          if (task.status !== 'done' && task.status !== 'failed') return;
          const key = `task:${event.taskId}:${task.status}`;
          if (seen.current.has(key)) return;
          seen.current.add(key);
          if (task.status === 'done') {
            toast.success(task.title, { description: task.summary ?? t('taskDone') });
          } else {
            toast.error(task.title, { description: task.summary ?? t('taskFailed') });
          }
        } catch {
          // Ignore transient fetch failures.
        }
        return;
      }

      if (event.type === 'message.updated' && !inChatRef.current) {
        try {
          const messages = await api.history(event.conversationId);
          const message = messages.find((item) => item.id === event.messageId);
          if (!message || message.role !== 'assistant') return;
          for (const action of message.actions) {
            if (action.kind !== 'action' || action.status !== 'pending') continue;
            const key = `action:${action.id}`;
            if (seen.current.has(key)) continue;
            seen.current.add(key);
            const toastId = toast(action.label, {
              description: message.text ? message.text.slice(0, 140) : undefined,
              duration: 15_000,
              action: {
                label: t('confirm'),
                onClick: () => {
                  void api
                    .press(action.id)
                    .then((res) => {
                      if (res.status === 'failed') toast.error(res.text);
                      else toast.success(res.text);
                    })
                    .catch((err: unknown) => toast.error(errorMessage(err)))
                    .finally(() => toast.dismiss(toastId));
                },
              },
            });
          }
        } catch {
          // Ignore transient fetch failures.
        }
        return;
      }

      if (event.type === 'metrics.updated') {
        const now = Date.now();
        if (now - lastInsightAt.current < 10_000) return;
        lastInsightAt.current = now;
        toast.info(t('newInsight'));
      }
    },
    [account, client, errorMessage, project, t],
  );

  useWorkStream(account, project, handleEvent);
  return null;
}

/** Subscribes to project SSE events across the shell and surfaces important events & inline approvals in Sonner. */
export function ProjectEventsToast({ isInChat }: { isInChat: boolean }) {
  const { project } = useActiveProject();
  if (!project) return null;
  return (
    <ProjectEventSubscriber
      key={`${project.accountId}:${project.id}`}
      account={project.accountId}
      project={project.id}
      isInChat={isInChat}
    />
  );
}
