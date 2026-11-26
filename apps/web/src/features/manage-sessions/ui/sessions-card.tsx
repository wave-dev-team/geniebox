'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@workspace/ui/components/button';
import { Skeleton } from '@workspace/ui/components/skeleton';

import { describeUserAgent, type UserSession, useSessions } from '@/entities/session';
import { authApi, profileApi, queryKeys } from '@/shared/api';
import { routes } from '@/shared/config/routes';
import { useErrorMessage } from '@/shared/lib/api-error';
import { useConfirm } from '@/shared/ui/confirm-dialog';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';

/** Sign-in sessions with "sign out" per device and everywhere (H09). */
export function SessionsCard() {
  const t = useTranslations('profile.security');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const errorMessage = useErrorMessage();
  const sessions = useSessions();

  const revoke = useMutation({
    mutationFn: async (sessionId: string) => {
      await profileApi.revokeSession(sessionId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
      toast(t('ended'));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const signOutEverywhere = async () => {
    const ok = await confirm({
      title: t('endAllConfirm.title'),
      description: t('endAllConfirm.text'),
      confirmLabel: t('endAllConfirm.ok'),
    });
    if (!ok) {
      return;
    }
    try {
      await authApi.logoutAll();
    } catch (error) {
      toast.error(errorMessage(error));
      return;
    }
    window.location.replace(routes.login());
  };

  const label = (session: UserSession) => {
    const { os, browser } = describeUserAgent(session.userAgent);
    const device = [os, browser].filter(Boolean).join(' · ') || t('unknownDevice');
    return session.current ? t('thisDevice') : device;
  };

  const hint = (session: UserSession) => {
    const { os, browser } = describeUserAgent(session.userAgent);
    const parts = session.current ? [[os, browser].filter(Boolean).join(' · ')] : [];
    if (session.ip) {
      parts.push(session.ip);
    }
    parts.push(format.relativeTime(new Date(session.lastActiveAt), now));
    return parts.filter(Boolean).join(' · ');
  };

  return (
    <SettingsCard
      title={t('sessions')}
      description={t('sessionsHint')}
      footer={
        <Button
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={() => void signOutEverywhere()}
        >
          {t('endAll')}
        </Button>
      }
    >
      {sessions.isPending ? (
        <div className="flex flex-col gap-3 px-5 py-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : (
        (sessions.data ?? []).map((session) => (
          <SettingsRow key={session.id} label={label(session)} hint={hint(session)}>
            {session.current ? (
              <span className="text-sm text-muted-foreground">{t('current')}</span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={revoke.isPending && revoke.variables === session.id}
                onClick={() => revoke.mutate(session.id)}
              >
                {t('end')}
              </Button>
            )}
          </SettingsRow>
        ))
      )}
    </SettingsCard>
  );
}
