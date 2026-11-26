'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@workspace/ui/components/alert-dialog';
import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';
import { Label } from '@workspace/ui/components/label';

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  /** Destructive styling for the confirm button; true by default (K08). */
  danger?: boolean;
  /** Word the user must type; defaults to «подтверждаю» (design rule: every confirm has input). */
  word?: string;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<Confirm | null>(null);

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/** App-wide confirmation dialog with a typed confirmation word (K08, H06). */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  const [pending, setPending] = React.useState<PendingConfirm | null>(null);
  const [typed, setTyped] = React.useState('');
  const inputId = React.useId();

  const confirm = React.useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setTyped('');
        setPending({ ...options, resolve });
      }),
    [],
  );

  const close = (result: boolean) => {
    pending?.resolve(result);
    setPending(null);
  };

  const word = pending?.word ?? t('confirmWord');
  const matches = typed.trim().toLocaleLowerCase() === word.toLocaleLowerCase();

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && close(false)}>
        <AlertDialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (matches) {
                close(true);
              }
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
              {pending?.description ? (
                <AlertDialogDescription>{pending.description}</AlertDialogDescription>
              ) : null}
            </AlertDialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={inputId} className="font-normal">
                <span>{t.rich('confirmPrompt', { word, b: (chunks) => <b>{chunks}</b> })}</span>
              </Label>
              <Input
                id={inputId}
                autoFocus
                autoComplete="off"
                placeholder={word}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>
            <AlertDialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                variant={pending?.danger === false ? 'default' : 'destructive'}
                disabled={!matches}
              >
                {pending?.confirmLabel}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Confirm {
  const confirm = React.useContext(ConfirmContext);
  if (!confirm) {
    throw new Error('useConfirm must be used within ConfirmProvider');
  }
  return confirm;
}
