'use client';

import { useMutation } from '@tanstack/react-query';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { Input } from '@workspace/ui/components/input';
import { Label } from '@workspace/ui/components/label';
import { Textarea } from '@workspace/ui/components/textarea';

import { useMe } from '@/entities/session';
import { accountDescriptionKey, useWorkspaces } from '@/entities/workspace';
import { accountsApi } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';

export function CreateAccountDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('workspace');
  const errorMessage = useErrorMessage();
  const me = useMe();
  const directory = useWorkspaces();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () => accountsApi.create(name.trim()),
    onSuccess: (account) => {
      if (me.data && description.trim()) {
        try {
          localStorage.setItem(accountDescriptionKey(me.data.id, account.id), description.trim());
        } catch {
          toast.error(t('descriptionStorageError'));
        }
      }
      directory.activate(account);
      toast.success(t('accountCreated'));
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={!create.isPending}>
        <DialogHeader>
          <DialogTitle>{t('newAccount')}</DialogTitle>
          <DialogDescription>{t('createHint')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !create.isPending) create.mutate();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="create-account-name">{t('name')}</Label>
            <Input
              id="create-account-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="create-account-description">{t('description')}</Label>
            <Textarea
              id="create-account-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              aria-describedby="description-storage"
            />
            <p id="description-storage" className="text-xs text-muted-foreground">
              {t('descriptionLocal')}
            </p>
          </div>
          {create.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(create.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FirstAccountDialog() {
  const pathname = usePathname();
  const search = useSearchParams();
  const directory = useWorkspaces();
  const [dismissed, setDismissed] = useState(false);
  const joining =
    pathname === '/invitations/accept' || (pathname === '/settings' && Boolean(search.get('invite')));
  if (dismissed || joining || !directory.isSuccess || directory.data.workspaces.length > 0) return null;
  return <CreateAccountDialog onClose={() => setDismissed(true)} />;
}
