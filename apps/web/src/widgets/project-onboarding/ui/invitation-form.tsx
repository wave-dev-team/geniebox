'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';

import { useMe } from '@/entities/session';
import { useWorkspaces } from '@/entities/workspace';
import { accountsApi } from '@/shared/api';
import { routes } from '@/shared/config/routes';
import { useErrorMessage } from '@/shared/lib/api-error';
import { AuthLayout } from '@/widgets/auth-layout/ui/auth-layout';

export function InvitationForm({ token }: { token: string }) {
  const t = useTranslations('workspace');
  const onboarding = useTranslations('onboarding');
  const router = useRouter();
  const me = useMe();
  const directory = useWorkspaces();
  const errorMessage = useErrorMessage();
  const accept = useMutation({
    mutationFn: accountsApi.join,
    onSuccess: (account) => {
      directory.activate(account);
      router.replace(routes.root());
    },
  });

  return (
    <AuthLayout title={t('join')} subtitle={t('codeHelp')}>
      {me.data?.emailVerified ? (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!accept.isPending)
              accept.mutate(String(new FormData(event.currentTarget).get('token')).trim());
          }}
        >
          <label className="grid gap-2 text-sm font-medium">
            {t('code')}
            <Input name="token" defaultValue={token} required minLength={20} maxLength={100} />
          </label>
          {accept.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(accept.error)}
            </p>
          )}
          <Button type="submit" disabled={accept.isPending}>
            {t('joinAction')}
          </Button>
        </form>
      ) : (
        <Button render={<Link href={routes.verifyEmail(routes.invitation(token))} />} nativeButton={false}>
          {t('verifyFirst')}
        </Button>
      )}
      <Link href={routes.onboarding()} className="text-center text-sm text-muted-foreground underline">
        {onboarding('createTitle')}
      </Link>
    </AuthLayout>
  );
}
