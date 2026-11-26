'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';

import { type CreateWorkTask, taskFieldsSchema, type WorkTask } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { Field, FieldLabel } from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import { Spinner } from '@workspace/ui/components/spinner';
import { Textarea } from '@workspace/ui/components/textarea';

interface AgentOption {
  id: string;
  name: string;
  enabled: boolean;
}

export function TaskEditor({
  item,
  agents,
  preferredAgent,
  onClose,
  onSave,
}: {
  item?: WorkTask;
  agents: AgentOption[];
  preferredAgent?: string;
  onClose: () => void;
  onSave: (values: CreateWorkTask) => Promise<WorkTask>;
}) {
  const t = useTranslations('tasks');
  const id = useId();
  const requestId = useRef<string>(null);
  const saving = useRef(false);
  const [title, setTitle] = useState(item?.title ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [date, setDate] = useState(item?.dueOn ?? '');
  const [agent, setAgent] = useState(preferredAgent ?? 'self');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const available = agents.filter((option) => option.enabled);
  const selected = available.find((option) => option.id === agent);
  const agentValue = selected?.id ?? 'self';

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(item ? 'edit' : 'create')}</DialogTitle>
          <DialogDescription>{t(item ? 'editDescription' : 'createDescription')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (saving.current) return;
            const fields = taskFieldsSchema.safeParse({ title, description, dueOn: date || null });
            if (!fields.success) {
              setError(true);
              return;
            }
            saving.current = true;
            setError(false);
            setPending(true);
            requestId.current ??= crypto.randomUUID();
            try {
              await onSave({ ...fields.data, id: requestId.current, agentId: selected?.id ?? null });
            } catch {
              setError(true);
            } finally {
              saving.current = false;
              setPending(false);
            }
          }}
        >
          <Field>
            <FieldLabel htmlFor={`${id}-title`}>{t('fieldTitle')}</FieldLabel>
            <Input
              id={`${id}-title`}
              maxLength={160}
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-description`}>{t('fieldDescription')}</FieldLabel>
            <Textarea
              id={`${id}-description`}
              maxLength={4000}
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-date`}>{t('fieldDue')}</FieldLabel>
            <Input
              id={`${id}-date`}
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          {!item && (
            <Field>
              <FieldLabel htmlFor={`${id}-agent`}>{t('fieldAgent')}</FieldLabel>
              <Select value={agentValue} onValueChange={(value) => value && setAgent(value)}>
                <SelectTrigger id={`${id}-agent`} className="w-full">
                  <SelectValue>{selected?.name ?? t('self')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">{t('self')}</SelectItem>
                  {available.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t('saveError')}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" type="button" disabled={pending} onClick={onClose}>
              {t('close')}
            </Button>
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending && <Spinner />}
              {t(item ? 'save' : 'create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
