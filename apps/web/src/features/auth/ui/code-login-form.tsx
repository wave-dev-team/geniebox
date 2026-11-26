'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@workspace/ui/components/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { Spinner } from '@workspace/ui/components/spinner';

import { useAuthSchemas } from '../model/schemas';
import { useCompleteSignIn } from '../model/use-complete-sign-in';

import { authApi } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { useCountdown } from '@/shared/lib/use-countdown';
import { CodeInput } from '@/shared/ui/code-input';

const RESEND_SECONDS = 60;

/**
 * Passwordless sign-in: email → 6-digit code. The first successful code also signs the user
 * up and verifies the email, which is what an invited member needs.
 */
export function CodeLoginForm({ defaultEmail = '' }: { defaultEmail?: string }) {
  const t = useTranslations('auth');
  const schemas = useAuthSchemas();
  const errorMessage = useErrorMessage();
  const completeSignIn = useCompleteSignIn();
  const countdown = useCountdown(RESEND_SECONDS);
  const [email, setEmail] = React.useState(defaultEmail);
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const sendCode = async (target: string) => {
    setError(null);
    const parsed = schemas.email.safeParse(target);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? null);
      return;
    }
    setBusy(true);
    try {
      await authApi.requestLoginCode(parsed.data);
      setSentTo(parsed.data);
      setCode('');
      countdown.start();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string) => {
    if (!sentTo || !/^\d{6}$/.test(value)) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await completeSignIn(await authApi.loginWithCode({ email: sentTo, code: value }));
    } catch (cause) {
      setError(errorMessage(cause));
      setCode('');
      setBusy(false);
    }
  };

  if (!sentTo) {
    return (
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void sendCode(email);
        }}
      >
        <FieldGroup>
          <Field data-invalid={Boolean(error) || undefined}>
            <FieldLabel htmlFor="code-email">{t('email')}</FieldLabel>
            <Input
              id="code-email"
              type="email"
              autoComplete="email"
              placeholder={t('emailPlaceholder')}
              value={email}
              aria-invalid={Boolean(error) || undefined}
              onChange={(event) => setEmail(event.target.value)}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? <Spinner /> : null}
            {t('code.sendCode')}
          </Button>
        </FieldGroup>
      </form>
    );
  }

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
          <FieldLabel htmlFor="code-value" className="justify-center">
            {t('code.codeLabel')}
          </FieldLabel>
          <CodeInput
            id="code-value"
            value={code}
            onChange={setCode}
            onComplete={(value) => void verify(value)}
            invalid={Boolean(error)}
            disabled={busy}
          />
          <FieldDescription className="text-center">{t('code.sentTo', { email: sentTo })}</FieldDescription>
          {error ? <FieldError className="text-center">{error}</FieldError> : null}
        </Field>
        <Button type="submit" size="lg" disabled={busy || code.length < 6}>
          {busy ? <Spinner /> : null}
          {t('code.confirm')}
        </Button>
        <div className="flex justify-between text-sm">
          <Button
            type="button"
            variant="link"
            className="h-auto px-0 text-muted-foreground"
            onClick={() => setSentTo(null)}
          >
            {t('code.changeEmail')}
          </Button>
          <Button
            type="button"
            variant="link"
            className="h-auto px-0 text-muted-foreground"
            disabled={countdown.left > 0 || busy}
            onClick={() => void sendCode(sentTo)}
          >
            {countdown.left > 0 ? t('code.resendIn', { seconds: countdown.left }) : t('code.resend')}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
