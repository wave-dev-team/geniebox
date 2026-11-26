'use client';

import { ArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useRef, useState } from 'react';

import { chatMessageMaxLength } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Spinner } from '@workspace/ui/components/spinner';

export function Composer({
  onSend,
  disabled,
  sending,
  home = false,
}: {
  onSend: (message: string) => Promise<boolean>;
  disabled: boolean;
  sending: boolean;
  home?: boolean;
}) {
  const t = useTranslations('composer');
  const [text, setText] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const placeholder = t(home ? 'placeholderHome' : 'placeholderManager');
  const canSend = !!text.trim() && !disabled && !sending;

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight, 200)}px`;
  }, [text]);

  return (
    <form
      className="flex items-end gap-2 rounded-2xl border bg-background p-3 shadow-sm focus-within:ring-3 focus-within:ring-ring/30"
      onSubmit={async (event) => {
        event.preventDefault();
        if (canSend && (await onSend(text.trim()))) setText('');
      }}
    >
      <textarea
        ref={areaRef}
        value={text}
        rows={home ? 2 : 1}
        maxLength={chatMessageMaxLength}
        readOnly={sending}
        autoFocus={home}
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        className="max-h-50 min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-base outline-none placeholder:text-muted-foreground"
      />
      <Button
        type="submit"
        size="icon"
        aria-label={t('send')}
        disabled={!canSend}
        className="shrink-0 rounded-full"
      >
        {sending ? <Spinner /> : <ArrowUp />}
      </Button>
    </form>
  );
}
