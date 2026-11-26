'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@workspace/ui/components/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { Spinner } from '@workspace/ui/components/spinner';

import { useAuthSchemas } from '../model/schemas';
import { useCompleteSignIn, useNextPath } from '../model/use-complete-sign-in';
import { CodeLoginForm } from './code-login-form';
import { OrSeparator } from './or-separator';

import { authApi } from '@/shared/api';
import { routes } from '@/shared/config/routes';
import { useErrorMessage } from '@/shared/lib/api-error';
import { PasswordInput } from '@/shared/ui/password-input';

/** Sign-in by password with a switch to the email-code flow (G06). */
export function LoginForm() {
  const t = useTranslations('auth');
  const [mode, setMode] = React.useState<'password' | 'code'>('password');
  const [email, setEmail] = React.useState('');
  const next = useNextPath();

  return (
    <div className="flex flex-col gap-6">
      {mode === 'password' ? (
        <PasswordLogin defaultEmail={email} onEmail={setEmail} />
      ) : (
        <CodeLoginForm defaultEmail={email} />
      )}
      <OrSeparator />
      <Button variant="outline" size="lg" onClick={() => setMode(mode === 'password' ? 'code' : 'password')}>
        {mode === 'password' ? t('codeMode') : t('passwordMode')}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t('noAccount')}{' '}
        <Link
          href={routes.signup(next)}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t('createProject')}
        </Link>
      </p>
    </div>
  );
}

function PasswordLogin({
  defaultEmail,
  onEmail,
}: {
  defaultEmail: string;
  onEmail: (email: string) => void;
}) {
  const t = useTranslations('auth');
  const schemas = useAuthSchemas();
  const errorMessage = useErrorMessage();
  const completeSignIn = useCompleteSignIn();
  const next = useNextPath();
  const schema = React.useMemo(
    () => z.object({ email: schemas.email, password: schemas.password }),
    [schemas],
  );
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: defaultEmail, password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await completeSignIn(await authApi.login(values));
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <form noValidate onSubmit={onSubmit}>
      <FieldGroup>
        <Field data-invalid={Boolean(errors.email) || undefined}>
          <FieldLabel htmlFor="login-email">{t('email')}</FieldLabel>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder={t('emailPlaceholder')}
            aria-invalid={Boolean(errors.email) || undefined}
            {...form.register('email', { onChange: (event) => onEmail(event.target.value) })}
          />
          <FieldError errors={[errors.email]} />
        </Field>
        <Field data-invalid={Boolean(errors.password) || undefined}>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="login-password">{t('password')}</FieldLabel>
            <Link
              href={routes.resetPassword(next)}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t('forgot')}
            </Link>
          </div>
          <PasswordInput
            id="login-password"
            autoComplete="current-password"
            aria-invalid={Boolean(errors.password) || undefined}
            {...form.register('password')}
          />
          <FieldError errors={[errors.password]} />
        </Field>
        {errors.root ? <FieldError>{errors.root.message}</FieldError> : null}
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? <Spinner /> : null}
          {t('signIn')}
        </Button>
      </FieldGroup>
    </form>
  );
}
