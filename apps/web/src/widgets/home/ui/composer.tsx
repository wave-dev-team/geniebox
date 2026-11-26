'use client';

import { ArrowUp, AtSign, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useRef, useState } from 'react';

import { Button } from '@workspace/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';

const requestModes = ['approve_all', 'approve_important', 'recommend_only'] as const;

export function Composer({ onSend }: { onSend: () => void }) {
  const t = useTranslations('composer');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<(typeof requestModes)[number]>('approve_all');
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = text.trim().length > 0;

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight, 200)}px`;
  }, [text]);

  return (
    <form
      className="flex flex-col gap-2 rounded-2xl border bg-background p-3 shadow-sm focus-within:ring-3 focus-within:ring-ring/30"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      <textarea
        ref={areaRef}
        value={text}
        rows={2}
        autoFocus
        aria-label={t('placeholderHome')}
        placeholder={t('placeholderHome')}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        className="max-h-50 min-h-12 w-full resize-none bg-transparent px-1 text-[15px] outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('mention')} disabled>
          <AtSign />
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('mode')}
                  className="text-muted-foreground"
                />
              }
            >
              {t(`modes.${mode}.label`)}
              <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-72">
              <DropdownMenuGroup>
                <DropdownMenuRadioGroup
                  value={mode}
                  onValueChange={(value) => {
                    const next = requestModes.find((item) => item === value);
                    if (next) setMode(next);
                  }}
                >
                  {requestModes.map((item) => (
                    <DropdownMenuRadioItem key={item} value={item} className="items-start">
                      <span className="flex flex-col gap-0.5">
                        <span className="font-medium">{t(`modes.${item}.label`)}</span>
                        <span className="text-xs text-muted-foreground">{t(`modes.${item}.note`)}</span>
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="submit"
            size="icon-sm"
            aria-label={t('send')}
            disabled={!canSend}
            className="rounded-full"
          >
            <ArrowUp />
          </Button>
        </div>
      </div>
    </form>
  );
}
