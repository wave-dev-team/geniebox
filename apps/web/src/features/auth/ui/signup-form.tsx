'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { PASSWORD_MIN_LENGTH } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { Spinner } from '@workspace/ui/components/spinner';

import { useAuthSchemas } from '../model/schemas';
import { useCompleteSignIn, useNextPath } from '../model/use-complete-sign-in';

import { authApi } from '@/shared/api';
import { routes } from '@/shared/config/routes';
import { useErrorMessage } from '@/shared/lib/api-error';
import { PasswordInput } from '@/shared/ui/password-input';

/**
 * Sign-up with email and password. The backend signs the user in right away and emails a
 * verification code from the confirmation screen.
 */
export function SignupForm() {
  const t = useTranslations('auth');
  const tv = useTranslations('auth.validation');
  const locale = useLocale();
  const schemas = useAuthSchemas();
  const errorMessage = useErrorMessage();
  const completeSignIn = useCompleteSignIn();
  const next = useNextPath();
  const schema = React.useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, tv('required')).max(100),
        email: schemas.email,
        password: schemas.newPassword,
      }),
    [schemas, tv],
  );
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await authApi.register(values);
      await completeSignIn(result, routes.verifyEmail(next ?? routes.onboarding()));
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <div className="flex flex-col gap-6">
      <form noValidate onSubmit={onSubmit} lang={locale}>
        <FieldGroup>
          <Field data-invalid={Boolean(errors.name) || undefined}>
            <FieldLabel htmlFor="signup-name">{t('name')}</FieldLabel>
            <Input
              id="signup-name"
              autoComplete="name"
              placeholder={t('namePlaceholder')}
              aria-invalid={Boolean(errors.name) || undefined}
              {...form.register('name')}
            />
            <FieldError errors={[errors.name]} />
          </Field>
          <Field data-invalid={Boolean(errors.email) || undefined}>
            <FieldLabel htmlFor="signup-email">{t('email')}</FieldLabel>
            <Input
              id="signup-email"
              type="email"
              autoComplete="email"
              placeholder={t('emailPlaceholder')}
              aria-invalid={Boolean(errors.email) || undefined}
              {...form.register('email')}
            />
            <FieldError errors={[errors.email]} />
          </Field>
          <Field data-invalid={Boolean(errors.password) || undefined}>
            <FieldLabel htmlFor="signup-password">{t('password')}</FieldLabel>
            <PasswordInput
              id="signup-password"
              autoComplete="new-password"
              placeholder={t('newPasswordPlaceholder')}
              aria-invalid={Boolean(errors.password) || undefined}
              {...form.register('password')}
            />
            {errors.password ? (
              <FieldError errors={[errors.password]} />
            ) : (
              <FieldDescription>{t('signup.passwordHint', { min: PASSWORD_MIN_LENGTH })}</FieldDescription>
            )}
          </Field>
          {errors.root ? <FieldError>{errors.root.message}</FieldError> : null}
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? <Spinner /> : null}
            {t('signup.submit')}
          </Button>
        </FieldGroup>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        {t('haveAccount')}{' '}
        <Link
          href={routes.login(next)}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t('signInLink')}
        </Link>
      </p>
    </div>
  );
}
