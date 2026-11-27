'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@workspace/ui/components/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field';
import { Spinner } from '@workspace/ui/components/spinner';

import { useMe } from '@/entities/session';
import { ApiError, authApi, queryKeys } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { useCountdown } from '@/shared/lib/use-countdown';
import { CodeInput } from '@/shared/ui/code-input';

const RESEND_SECONDS = 60;

export function VerifyEmailForm({ onVerified }: { onVerified: () => void }) {
  const t = useTranslations('auth');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const { left, start } = useCountdown(RESEND_SECONDS);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const userId = useMe().data?.id;
  const sent = React.useRef(false);
  const verifying = React.useRef(false);

  const resend = React.useCallback(
    async (silent = false) => {
      setError(null);
      try {
        await authApi.requestVerification();
        start();
        if (!silent) {
          toast(t('verify.resent'));
        }
      } catch (cause) {
        if (silent && cause instanceof ApiError && cause.code === 'CODE_RESEND_TOO_SOON') start();
        else setError(errorMessage(cause));
      }
    },
    [errorMessage, start, t],
  );

  React.useEffect(() => {
    if (!userId || sent.current) return;
    sent.current = true;
    if (sessionStorage.getItem('geniebox:verification-sent') === userId) {
      sessionStorage.removeItem('geniebox:verification-sent');
      start();
    } else {
      void resend(true);
    }
  }, [resend, start, userId]);

  const verify = async (value: string) => {
    if (verifying.current || !/^\d{6}$/.test(value)) {
      return;
    }
    verifying.current = true;
    setError(null);
    setBusy(true);
    try {
      await authApi.verifyEmail(value);
      await queryClient.invalidateQueries({ queryKey: queryKeys.me() });
      onVerified();
    } catch (cause) {
      setError(errorMessage(cause));
      setCode('');
      setBusy(false);
      verifying.current = false;
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void verify(code);
      }}
    >
      <FieldGroup>
        <Field data-invalid={Boolean(error) || undefined}>
          <FieldLabel htmlFor="verify-code" className="justify-center">
            {t('code.codeLabel')}
          </FieldLabel>
          <CodeInput
            id="verify-code"
            value={code}
            onChange={setCode}
            onComplete={(value) => void verify(value)}
            invalid={Boolean(error)}
            disabled={busy}
          />
          {error ? <FieldError className="text-center">{error}</FieldError> : null}
        </Field>
        <Button type="submit" size="lg" disabled={busy || code.length < 6}>
          {busy ? <Spinner /> : null}
          {t('verify.submit')}
        </Button>
        <Button
          type="button"
          variant="link"
          className="h-auto text-muted-foreground"
          disabled={left > 0 || busy}
          onClick={() => void resend()}
        >
          {left > 0 ? t('code.resendIn', { seconds: left }) : t('code.resend')}
        </Button>
      </FieldGroup>
    </form>
  );
}
