'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';

import { Button } from '@workspace/ui/components/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { Spinner } from '@workspace/ui/components/spinner';

import { describeConnectionLink, submitConnectionLink } from '@/shared/api';
import { routes } from '@/shared/config/routes';
import { useErrorMessage } from '@/shared/lib/api-error';
import { AuthLayout } from '@/widgets/auth-layout';

export function ConnectLinkForm({
  token,
  embedded = false,
  onDone,
}: {
  token: string;
  embedded?: boolean;
  onDone?: () => void;
}) {
  const t = useTranslations('connectLink');
  const tc = useTranslations('connections');
  const errorMessage = useErrorMessage();
  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ status: string; detail?: string | null } | null>(null);

  const info = useQuery({
    queryKey: ['connect-link', token],
    queryFn: ({ signal }) => describeConnectionLink(token, signal),
    retry: false,
  });

  const submit = useMutation({
    mutationFn: () => {
      const payload: Record<string, string> = {};
      for (const field of info.data?.provider.fields ?? []) {
        const val = (values[field.key] ?? field.defaultValue ?? '').trim();
        if (val) payload[field.key] = val;
      }
      return submitConnectionLink(token, payload);
    },
    onSuccess: (res) => {
      setDone({
        status: res.check?.status ?? 'ok',
        detail: res.check?.detail ?? res.check?.reason ?? null,
      });
    },
  });

  const wrap = (title: string, subtitle: string, body: ReactNode) =>
    embedded ? (
      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {body}
      </div>
    ) : (
      <AuthLayout title={title} subtitle={subtitle}>
        {body}
      </AuthLayout>
    );

  if (info.isPending) {
    return wrap(
      t('loadingTitle'),
      t('loadingSubtitle'),
      <div className="flex justify-center py-6">
        <Spinner />
      </div>,
    );
  }

  if (info.isError || !info.data) {
    return wrap(
      t('invalidTitle'),
      t('invalidSubtitle'),
      embedded && onDone ? (
        <Button variant="outline" onClick={onDone}>
          {t('close')}
        </Button>
      ) : (
        <Button variant="outline" nativeButton={false} render={<Link href={routes.root()} />}>
          {t('backHome')}
        </Button>
      ),
    );
  }

  const providerKey = info.data.provider.key;
  const providerTitle = tc.has(`providers.${providerKey}.title`)
    ? tc(`providers.${providerKey}.title`)
    : providerKey;

  if (done) {
    return wrap(
      t('doneTitle'),
      t('doneSubtitle', { project: info.data.projectName, provider: providerTitle }),
      <div className="flex flex-col items-center gap-4 rounded-xl border bg-card p-5 text-center">
        <CheckCircle2 className="size-8 text-emerald-500" />
        <p className="text-sm text-muted-foreground">
          {done.status === 'ok' ? t('checkOk') : (done.detail ?? t('checkWarn'))}
        </p>
        {embedded && onDone ? (
          <Button onClick={onDone}>{t('close')}</Button>
        ) : (
          <Button nativeButton={false} render={<Link href={routes.root()} />}>
            {t('backHome')}
          </Button>
        )}
      </div>,
    );
  }

  return wrap(
    t('title', { provider: providerTitle }),
    t('subtitle', { project: info.data.projectName }),
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate();
      }}
    >
      <FieldGroup>
        {info.data.provider.fields.map((field) => {
          const label = tc.has(`fields.${field.key}`) ? tc(`fields.${field.key}`) : field.key;
          const current = values[field.key] ?? field.defaultValue ?? '';
          return (
            <Field key={field.key}>
              <FieldLabel htmlFor={`connect-${field.key}`}>
                {label}
                {field.required ? ' *' : ''}
              </FieldLabel>
              <Input
                id={`connect-${field.key}`}
                type={field.kind === 'secret' ? 'password' : 'text'}
                required={field.required}
                value={current}
                disabled={submit.isPending}
                placeholder={field.defaultValue ?? label}
                onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
              />
            </Field>
          );
        })}
        {submit.isError ? <FieldError>{errorMessage(submit.error)}</FieldError> : null}
        <Button type="submit" size="lg" disabled={submit.isPending}>
          {submit.isPending ? <Spinner /> : <KeyRound className="size-4" />}
          {t('submit')}
        </Button>
      </FieldGroup>
    </form>,
  );
}
