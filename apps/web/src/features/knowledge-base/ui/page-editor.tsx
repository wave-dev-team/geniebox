import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Button } from '@workspace/ui/components/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs';
import { Textarea } from '@workspace/ui/components/textarea';

import { bodyLimit, type Knowledge, pageSchema, titleLimit, useKnowledgeError } from '../model/knowledge';
import { KnowledgeMarkdown } from './knowledge-ui';

import type { KnowledgeNode } from '@/shared/api';

export function PageEditor({
  knowledge,
  node,
  canPublish,
  onClose,
  onBlockingChange,
}: {
  knowledge: Knowledge;
  node: KnowledgeNode;
  canPublish: boolean;
  onClose: () => void;
  onBlockingChange: (blocked: boolean) => void;
}) {
  const t = useTranslations('knowledge');
  const message = useKnowledgeError();
  const formId = useId();
  const form = useForm({
    defaultValues: { title: node.title, body: node.body },
    resolver: zodResolver(pageSchema),
  });
  const [title, body] = useWatch({ control: form.control, name: ['title', 'body'] });
  const values = pageSchema.safeParse({ title, body });
  const dirty = title !== node.title || body !== node.body;
  const canAutosave = node.status === 'draft' && node.kind === 'page';
  const inFlight = useRef(false);
  const lastFailed = useRef<{ title: string; body: string } | null>(null);
  const save = useMutation({
    mutationFn: ({ title, body }: { title: string; body: string }) =>
      knowledge.api.updateNode(node.id, {
        ...(title !== node.title ? { title } : {}),
        ...(node.kind === 'page' && body !== node.body ? { body } : {}),
      }),
    onSuccess: (updated, submitted) => {
      if (form.getValues('title').trim() === submitted.title) {
        form.setValue('title', updated.title);
      }
      if (form.getValues('body') === submitted.body) form.setValue('body', updated.body);
      lastFailed.current = null;
      knowledge.storeNode(updated);
    },
    onError: (_, submitted) => {
      lastFailed.current = submitted;
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const { mutate, isPending } = save;
  useEffect(() => {
    if (!canAutosave || !dirty || isPending) return;
    const data = pageSchema.safeParse({ title, body });
    if (!data.success || (data.data.title === node.title && data.data.body === node.body)) return;
    const timer = window.setTimeout(() => {
      if (inFlight.current) return;
      if (lastFailed.current?.title === data.data.title && lastFailed.current.body === data.data.body) return;
      inFlight.current = true;
      mutate(data.data);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [body, canAutosave, dirty, isPending, mutate, node.body, node.title, title]);

  useEffect(() => {
    const blocked = dirty || isPending;
    onBlockingChange(blocked);
    if (!blocked) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      onBlockingChange(false);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty, isPending, onBlockingChange]);

  const invalidTitle = Boolean(form.formState.errors.title);
  const needsPublishedBody = node.kind === 'page' && node.status === 'published' && canPublish;
  const missingPublishedBody = needsPublishedBody && !body.trim() && dirty;
  const invalidBody = Boolean(form.formState.errors.body) || missingPublishedBody;
  const status = isPending ? 'saving' : save.isError ? null : dirty ? 'unsaved' : 'saved';

  return (
    <form
      className="grid gap-5"
      onSubmit={form.handleSubmit((data) => {
        if (inFlight.current || (needsPublishedBody && !data.body.trim() && dirty)) return;
        if (data.title === node.title && data.body === node.body) {
          onClose();
          return;
        }
        inFlight.current = true;
        mutate(data, {
          onSuccess: (updated) => {
            if (form.getValues('title').trim() === updated.title && form.getValues('body') === updated.body) {
              onClose();
            }
          },
        });
      })}
    >
      <Field data-invalid={invalidTitle}>
        <FieldLabel htmlFor={`${formId}-title`}>{t('name')}</FieldLabel>
        <Input
          id={`${formId}-title`}
          autoFocus={node.kind === 'folder'}
          maxLength={titleLimit}
          aria-invalid={invalidTitle}
          aria-describedby={invalidTitle ? `${formId}-title-error` : undefined}
          {...form.register('title')}
        />
        {invalidTitle && <FieldError id={`${formId}-title-error`}>{t('titleRequired')}</FieldError>}
      </Field>
      {node.kind === 'page' && (
        <Tabs defaultValue="write">
          <TabsList aria-label={t('editorMode')}>
            <TabsTrigger value="write">{t('write')}</TabsTrigger>
            <TabsTrigger value="preview">{t('preview')}</TabsTrigger>
          </TabsList>
          <TabsContent value="write" keepMounted className="pt-2">
            <Field data-invalid={invalidBody}>
              <FieldLabel htmlFor={`${formId}-body`} className="sr-only">
                {t('body')}
              </FieldLabel>
              <Textarea
                id={`${formId}-body`}
                autoFocus
                rows={12}
                maxLength={bodyLimit}
                className="min-h-56 leading-relaxed"
                aria-invalid={invalidBody}
                aria-describedby={invalidBody ? `${formId}-body-error` : `${formId}-body-hint`}
                placeholder={t('bodyPlaceholder')}
                {...form.register('body')}
              />
              <FieldDescription id={`${formId}-body-hint`}>{t('markdownHint')}</FieldDescription>
              {invalidBody && (
                <FieldError id={`${formId}-body-error`}>
                  {t(missingPublishedBody ? 'publishEmptyHint' : 'bodyTooLong')}
                </FieldError>
              )}
            </Field>
          </TabsContent>
          <TabsContent value="preview" className="min-h-56 rounded-xl border p-4">
            <KnowledgeMarkdown body={body} />
          </TabsContent>
        </Tabs>
      )}
      {node.status === 'published' && (
        <p className="text-sm text-muted-foreground">
          {t(canPublish ? 'publishedEditHint' : 'reviewEditHint')}
        </p>
      )}
      {save.isError && (
        <p role="alert" className="text-sm text-destructive">
          {message(save.error)}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {status === 'saved' && <Check aria-hidden="true" className="size-3.5" />}
          {status && t(status)}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" type="button" disabled={isPending} onClick={onClose}>
            {t(dirty ? 'discard' : 'close')}
          </Button>
          <Button type="submit" disabled={isPending || !values.success || missingPublishedBody}>
            {t(dirty ? 'save' : 'done')}
          </Button>
        </div>
      </div>
    </form>
  );
}
