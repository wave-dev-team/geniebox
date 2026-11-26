'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field';
import { Spinner } from '@workspace/ui/components/spinner';

import { authApi, queryKeys } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { PasswordInput } from '@/shared/ui/password-input';

/**
 * Sets or changes the password. The backend signs out every other session, which the sessions
 * list then reflects.
 */
export function ChangePasswordDialog({
  hasPassword,
  open,
  onOpenChange,
}: {
  hasPassword: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('profile.security.passwordDialog');
  const tv = useTranslations('auth.validation');
  const tAuth = useTranslations('auth.signup');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const schema = React.useMemo(
    () =>
      z.object({
        currentPassword: hasPassword
          ? z.string().min(1, tv('required')).max(PASSWORD_MAX_LENGTH)
          : z.string().optional(),
        newPassword: z
          .string()
          .min(PASSWORD_MIN_LENGTH, tv('passwordMin', { min: PASSWORD_MIN_LENGTH }))
          .max(PASSWORD_MAX_LENGTH),
      }),
    [hasPassword, tv],
  );
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const { errors } = form.formState;

  const change = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) => {
      await authApi.changePassword(values);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me() });
      toast(t('done'));
      form.reset();
      onOpenChange(false);
    },
    onError: (error) => form.setError('root', { message: errorMessage(error) }),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          form.reset();
        }
        onOpenChange(value);
      }}
    >
      <DialogContent>
        <form
          noValidate
          onSubmit={form.handleSubmit((values) => change.mutate(values))}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{hasPassword ? t('changeTitle') : t('setTitle')}</DialogTitle>
            <DialogDescription className="sr-only">{t('title')}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {hasPassword ? (
              <Field data-invalid={Boolean(errors.currentPassword) || undefined}>
                <FieldLabel htmlFor="password-current">{t('current')}</FieldLabel>
                <PasswordInput
                  id="password-current"
                  autoComplete="current-password"
                  aria-invalid={Boolean(errors.currentPassword) || undefined}
                  {...form.register('currentPassword')}
                />
                <FieldError errors={[errors.currentPassword]} />
              </Field>
            ) : null}
            <Field data-invalid={Boolean(errors.newPassword) || undefined}>
              <FieldLabel htmlFor="password-new">{t('new')}</FieldLabel>
              <PasswordInput
                id="password-new"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.newPassword) || undefined}
                {...form.register('newPassword')}
              />
              {errors.newPassword ? (
                <FieldError errors={[errors.newPassword]} />
              ) : (
                <FieldDescription>{tAuth('passwordHint', { min: PASSWORD_MIN_LENGTH })}</FieldDescription>
              )}
            </Field>
            {errors.root ? <FieldError>{errors.root.message}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? <Spinner /> : null}
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
