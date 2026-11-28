'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@workspace/ui/components/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { Spinner } from '@workspace/ui/components/spinner';

import { useAuthSchemas } from '../model/schemas';
import { useCompleteSignIn, useNextPath } from '../model/use-complete-sign-in';

import { authApi } from '@/shared/api';
import { routes } from '@/shared/config/routes';
import { useErrorMessage } from '@/shared/lib/api-error';
import { useCountdown } from '@/shared/lib/use-countdown';
import { CodeInput } from '@/shared/ui/code-input';
import { PasswordInput } from '@/shared/ui/password-input';

const RESEND_SECONDS = 60;

/**
 * Password recovery: email → code + new password. The reset signs out every session, so the
 * form signs in with the new password right after.
 */
export function ResetPasswordForm() {
  const t = useTranslations('auth');
  const schemas = useAuthSchemas();
  const errorMessage = useErrorMessage();
  const completeSignIn = useCompleteSignIn();
  const next = useNextPath();
  const countdown = useCountdown(RESEND_SECONDS);
  const [email, setEmail] = React.useState('');
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [errors, setErrors] = React.useState<{
    email?: string;
    code?: string;
    password?: string;
    root?: string;
  }>({});
  const [busy, setBusy] = React.useState(false);

  const requestCode = async (target: string) => {
    const parsed = schemas.email.safeParse(target);
    if (!parsed.success) {
      setErrors({ email: parsed.error.issues[0]?.message });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await authApi.forgotPassword(parsed.data);
      setSentTo(parsed.data);
      countdown.start();
    } catch (cause) {
      setErrors({ root: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    const codeCheck = schemas.code.safeParse(code);
    const passwordCheck = schemas.newPassword.safeParse(password);
    if (!codeCheck.success || !passwordCheck.success || !sentTo) {
      setErrors({
        code: codeCheck.success ? undefined : codeCheck.error.issues[0]?.message,
        password: passwordCheck.success ? undefined : passwordCheck.error.issues[0]?.message,
      });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await authApi.resetPassword({ email: sentTo, code, newPassword: password });
      toast(t('reset.done'));
      await completeSignIn(await authApi.login({ email: sentTo, password }));
    } catch (cause) {
      setErrors({ root: errorMessage(cause) });
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {!sentTo ? (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void requestCode(email);
          }}
        >
          <FieldGroup>
            <Field data-invalid={Boolean(errors.email) || undefined}>
              <FieldLabel htmlFor="reset-email">{t('email')}</FieldLabel>
              <Input
                id="reset-email"
                type="email"
                autoComplete="email"
                placeholder={t('emailPlaceholder')}
                value={email}
                aria-invalid={Boolean(errors.email) || undefined}
                onChange={(event) => setEmail(event.target.value)}
              />
              {errors.email ? <FieldError>{errors.email}</FieldError> : null}
            </Field>
            {errors.root ? <FieldError>{errors.root}</FieldError> : null}
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? <Spinner /> : null}
              {t('reset.sendCode')}
            </Button>
          </FieldGroup>
        </form>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void reset();
          }}
        >
          <FieldGroup>
            <Field data-invalid={Boolean(errors.code) || undefined}>
              <FieldLabel htmlFor="reset-code" className="justify-center">
                {t('reset.codeLabel')}
              </FieldLabel>
              <CodeInput id="reset-code" value={code} onChange={setCode} invalid={Boolean(errors.code)} />
              <p className="text-center text-sm text-muted-foreground">
                {t('code.sentTo', { email: sentTo })}
              </p>
              {errors.code ? <FieldError className="text-center">{errors.code}</FieldError> : null}
            </Field>
            <Field data-invalid={Boolean(errors.password) || undefined}>
              <FieldLabel htmlFor="reset-password">{t('reset.newPassword')}</FieldLabel>
              <PasswordInput
                id="reset-password"
                autoComplete="new-password"
                placeholder={t('newPasswordPlaceholder')}
                value={password}
                aria-invalid={Boolean(errors.password) || undefined}
                onChange={(event) => setPassword(event.target.value)}
              />
              {errors.password ? <FieldError>{errors.password}</FieldError> : null}
            </Field>
            {errors.root ? <FieldError>{errors.root}</FieldError> : null}
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? <Spinner /> : null}
              {t('reset.submit')}
            </Button>
            <Button
              type="button"
              variant="link"
              className="h-auto text-muted-foreground"
              disabled={countdown.left > 0 || busy}
              onClick={() => void requestCode(sentTo)}
            >
              {countdown.left > 0 ? t('code.resendIn', { seconds: countdown.left }) : t('code.resend')}
            </Button>
          </FieldGroup>
        </form>
      )}
      <p className="text-center text-sm">
        <Link
          href={routes.login(next)}
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {t('reset.back')}
        </Link>
      </p>
    </div>
  );
}
