import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { Field, FieldError, FieldLabel } from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';

import { type Knowledge, titleLimit, titleSchema, useKnowledgeError } from '../model/knowledge';

import type { KnowledgeNode } from '@/shared/api';

const schema = z.object({ title: titleSchema });

export function CreateNodeDialog({
  knowledge,
  kind,
  parent,
  onClose,
  onCreated,
}: {
  knowledge: Knowledge;
  kind: KnowledgeNode['kind'];
  parent?: KnowledgeNode;
  onClose: () => void;
  onCreated: (node: KnowledgeNode) => void;
}) {
  const t = useTranslations('knowledge');
  const titleId = useId();
  const message = useKnowledgeError();
  const form = useForm({ defaultValues: { title: '' }, resolver: zodResolver(schema) });
  const create = useMutation({
    mutationFn: ({ title }: z.infer<typeof schema>) =>
      knowledge.api.createNode({ kind, title, parentId: parent?.id ?? null }),
    onSuccess: (node) => {
      knowledge.storeNode(node);
      onCreated(node);
    },
  });
  const invalid = Boolean(form.formState.errors.title);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t(kind === 'page' ? 'newPage' : 'newFolder')}</DialogTitle>
          <DialogDescription>
            {parent ? t('insideFolder', { title: parent.title }) : t('inLibrary')}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <Field data-invalid={invalid}>
            <FieldLabel htmlFor={titleId}>{t('name')}</FieldLabel>
            <Input
              id={titleId}
              autoFocus
              disabled={create.isPending}
              maxLength={titleLimit}
              aria-invalid={invalid}
              aria-describedby={invalid ? `${titleId}-error` : undefined}
              {...form.register('title')}
            />
            {invalid && <FieldError id={`${titleId}-error`}>{t('titleRequired')}</FieldError>}
          </Field>
          {create.isError && (
            <p role="alert" className="text-sm text-destructive">
              {message(create.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={create.isPending} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || !form.watch('title').trim()}>
              {t(create.isPending ? 'creating' : 'create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MoveNodeDialog({
  knowledge,
  node,
  nodes,
  destinations,
  onClose,
}: {
  knowledge: Knowledge;
  node: KnowledgeNode;
  nodes: KnowledgeNode[];
  destinations: { id: string; label: string }[];
  onClose: () => void;
}) {
  const t = useTranslations('knowledge');
  const message = useKnowledgeError();
  const destinationId = useId();
  const form = useForm({ defaultValues: { parent: node.parentId ?? '' } });
  const destination = form.watch('parent');
  const duplicate = nodes.some(
    (item) =>
      item.id !== node.id &&
      item.parentId === (destination || null) &&
      item.title.trim().toLowerCase() === node.title.trim().toLowerCase(),
  );
  const move = useMutation({
    mutationFn: ({ parent }: { parent: string }) =>
      knowledge.api.updateNode(node.id, { parentId: parent || null }),
    onSuccess: (updated) => {
      knowledge.storeNode(updated);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !move.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('move')}</DialogTitle>
          <DialogDescription>{node.title}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-5"
          onSubmit={form.handleSubmit((values) => {
            if (!duplicate) move.mutate(values);
          })}
        >
          <Field>
            <FieldLabel htmlFor={destinationId}>{t('destination')}</FieldLabel>
            <select
              id={destinationId}
              className="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              {...form.register('parent')}
            >
              <option value="">{t('title')}</option>
              {destinations.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {duplicate && (
            <p role="alert" className="text-destructive">
              {t('duplicateTitle')}
            </p>
          )}
          {move.isError && (
            <p role="alert" className="text-destructive">
              {message(move.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={move.isPending} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={move.isPending || duplicate || destination === (node.parentId ?? '')}
            >
              {t(move.isPending ? 'saving' : 'move')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
