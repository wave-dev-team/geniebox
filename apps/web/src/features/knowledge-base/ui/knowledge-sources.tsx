import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, FolderOpen, Upload } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type MouseEventHandler, useId } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { Textarea } from '@workspace/ui/components/textarea';

import { bodyLimit, type Knowledge, uploadLimit, useKnowledgeError } from '../model/knowledge';
import { EmptyState } from './knowledge-ui';

import type { KnowledgeNode, KnowledgeSource } from '@/shared/api';

export type SourceKind = 'upload' | 'text';

function storeSource(sources: KnowledgeSource[] | undefined, source: KnowledgeSource) {
  const list = sources ?? [];
  return list.some(({ id }) => id === source.id)
    ? list.map((item) => (item.id === source.id ? source : item))
    : [source, ...list];
}

export function KnowledgeSources({
  knowledge,
  sources,
  nodes,
  selectedId,
  onOpen,
  onUpload,
  onPaste,
}: {
  knowledge: Knowledge;
  sources: KnowledgeSource[];
  nodes: KnowledgeNode[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  onUpload: MouseEventHandler<HTMLButtonElement>;
  onPaste: MouseEventHandler<HTMLButtonElement>;
}) {
  const t = useTranslations('knowledge');
  const format = useFormatter();
  const client = useQueryClient();
  const errorMessage = useKnowledgeError();
  const retry = useMutation({
    mutationFn: knowledge.api.retrySource,
    onSuccess: (source) => {
      client.setQueryData<KnowledgeSource[]>(knowledge.keys.sources, (previous) =>
        storeSource(previous, source),
      );
      void client.invalidateQueries({ queryKey: knowledge.keys.sources });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const active = sources.find((source) => source.id === selectedId);
  const list = active ? [active, ...sources.filter((source) => source.id !== active.id)] : sources;

  return (
    <section>
      {list.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2 pb-4">
          <Button variant="outline" onClick={onPaste}>
            <FileText aria-hidden="true" />
            {t('paste')}
          </Button>
          <Button onClick={onUpload}>
            <Upload aria-hidden="true" />
            {t('upload')}
          </Button>
        </div>
      )}
      {!list.length ? (
        <EmptyState icon={FolderOpen} title={t('noSources')}>
          <Button variant="outline" onClick={onPaste}>
            {t('paste')}
          </Button>
          <Button onClick={onUpload}>
            <Upload aria-hidden="true" />
            {t('upload')}
          </Button>
        </EmptyState>
      ) : (
        <ul className="divide-y border-y">
          {list.map((source) => {
            const imported = nodes.filter((node) => node.kind === 'page' && node.sourceId === source.id);
            return (
              <li key={source.id} className="flex flex-wrap items-start gap-3 py-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <FileText className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium wrap-anywhere">{source.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(source.kind === 'text' ? 'textSource' : 'fileSource')} ·{' '}
                    {format.dateTime(new Date(source.createdAt), { dateStyle: 'medium' })}
                  </p>
                  {(source.periodStart || source.periodEnd) && (
                    <p className="text-xs text-muted-foreground">
                      {t('sourcePeriod', { start: source.periodStart ?? '—', end: source.periodEnd ?? '—' })}
                    </p>
                  )}
                  {source.status === 'failed' && (
                    <p className="pt-1 text-sm text-destructive">
                      {t(source.error?.includes('xlsx') ? 'workbookError' : 'processingError')}
                    </p>
                  )}
                  {source.status === 'ready' &&
                    (imported.length > 0 ? (
                      <ul className="flex flex-wrap gap-1.5 pt-2" aria-label={t('importedPages')}>
                        {imported.map((node) => (
                          <li key={node.id} className="min-w-0 max-w-full">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onOpen(node.id)}
                              title={node.title}
                              className="h-auto min-h-8 max-w-full justify-start text-left whitespace-normal"
                            >
                              <FileText aria-hidden="true" />
                              <span className="min-w-0 wrap-anywhere">{node.title}</span>
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t('noImportedPages')}</p>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      source.status === 'failed'
                        ? 'destructive'
                        : source.status === 'processing'
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {t(`sourceStatus.${source.status}`)}
                  </Badge>
                  {source.status === 'failed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retry.isPending}
                      onClick={() => retry.mutate(source.id)}
                    >
                      {t('retry')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const extensions = /\.(md|txt|csv|xlsx)$/i;
const fileSchema = z
  .file()
  .max(uploadLimit)
  .refine((file) => file.size > 0)
  .refine((file) => extensions.test(file.name));

const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('upload'),
    files: z.array(fileSchema).min(1),
  }),
  z.object({
    kind: z.literal('text'),
    title: z.string().trim().max(200),
    text: z
      .string()
      .max(bodyLimit)
      .refine((value) => Boolean(value.trim())),
  }),
]);

async function toBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function ImportSourceDialog({
  knowledge,
  kind,
  onClose,
  onImported,
}: {
  knowledge: Knowledge;
  kind: SourceKind;
  onClose: () => void;
  onImported: (id: string) => void;
}) {
  const t = useTranslations('knowledge');
  const id = useId();
  const message = useKnowledgeError();
  const client = useQueryClient();
  const isFile = kind === 'upload';
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    defaultValues: kind === 'upload' ? { kind, files: [] } : { kind, title: '', text: '' },
    resolver: zodResolver(schema),
  });
  const add = useMutation({
    mutationFn: async (values: z.output<typeof schema>) => {
      if (values.kind === 'upload') {
        const uploaded: KnowledgeSource[] = [];
        for (const item of values.files) {
          uploaded.push(
            await knowledge.api.createSource({
              kind: 'upload',
              filename: item.name,
              contentBase64: await toBase64(item),
            }),
          );
        }
        return uploaded;
      }
      return [
        await knowledge.api.createSource({
          kind: 'text',
          title: values.title || t('pastedSource'),
          text: values.text,
        }),
      ];
    },
    onSuccess: (sources) => {
      client.setQueryData<KnowledgeSource[]>(knowledge.keys.sources, (previous) =>
        sources.reduce((acc, source) => storeSource(acc, source), previous),
      );
      void client.invalidateQueries({ queryKey: knowledge.keys.sources });
      knowledge.refreshLibrary();
      const first = sources[0];
      toast.success(
        t(sources.length === 1 && first?.status !== 'processing' ? 'sourceExists' : 'sourceSubmitted'),
      );
      if (first) onImported(first.id);
    },
  });
  const files = form.watch('files') ?? [];
  const text = form.watch('text');
  const badFile = files.find((item) => !item.size || item.size > uploadLimit || !extensions.test(item.name));
  const invalidFile = Boolean(badFile);
  const invalidText = Boolean(text && text.length > bodyLimit);
  const fileError =
    badFile && badFile.size > uploadLimit
      ? 'fileTooLarge'
      : badFile?.size === 0
        ? 'fileEmpty'
        : 'fileTypeError';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !add.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t(isFile ? 'upload' : 'paste')}</DialogTitle>
          <DialogDescription>{t('sourcesHint')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={form.handleSubmit((values) => add.mutate(values))}>
          {isFile ? (
            <Controller
              control={form.control}
              name="files"
              render={({ field }) => (
                <Field data-invalid={invalidFile}>
                  <FieldLabel htmlFor={`${id}-file`}>{t('file')}</FieldLabel>
                  <Input
                    id={`${id}-file`}
                    ref={field.ref}
                    disabled={add.isPending}
                    type="file"
                    multiple
                    accept=".md,.txt,.csv,.xlsx"
                    className="h-auto min-h-10 py-2"
                    aria-invalid={invalidFile}
                    aria-describedby={invalidFile ? `${id}-file-error` : `${id}-hint`}
                    onBlur={field.onBlur}
                    onChange={(event) => field.onChange(Array.from(event.target.files ?? []))}
                  />
                  {files.length > 1 && (
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {files.map((item, idx) => (
                        <li key={`${item.name}-${idx}`} className="truncate">
                          {item.name}
                        </li>
                      ))}
                    </ul>
                  )}
                  <FieldDescription id={`${id}-hint`}>{t('uploadHint')}</FieldDescription>
                  {invalidFile && <FieldError id={`${id}-file-error`}>{t(fileError)}</FieldError>}
                </Field>
              )}
            />
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor={`${id}-title`}>{t('sourceTitle')}</FieldLabel>
                <Input
                  id={`${id}-title`}
                  autoFocus
                  disabled={add.isPending}
                  maxLength={200}
                  {...form.register('title')}
                />
              </Field>
              <Field data-invalid={invalidText}>
                <FieldLabel htmlFor={`${id}-text`}>{t('sourceText')}</FieldLabel>
                <Textarea
                  id={`${id}-text`}
                  rows={6}
                  disabled={add.isPending}
                  maxLength={bodyLimit}
                  aria-invalid={invalidText}
                  aria-describedby={invalidText ? `${id}-text-error` : undefined}
                  {...form.register('text')}
                />
                {invalidText && <FieldError id={`${id}-text-error`}>{t('bodyTooLong')}</FieldError>}
              </Field>
            </>
          )}
          {add.isError && (
            <p role="alert" className="text-sm text-destructive">
              {message(add.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={add.isPending} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                add.isPending || (isFile ? !files.length || invalidFile : !text?.trim() || invalidText)
              }
            >
              {t(add.isPending ? 'submittingSource' : 'submitSource')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
