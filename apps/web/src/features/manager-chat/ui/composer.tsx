'use client';

import { ArrowUp, AtSign, Bot, ChevronDown, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useRef, useState } from 'react';

import {
  chatMessageMaxLength,
  type ChatRequest,
  type ChatRequestMode,
  chatRequestModes,
} from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover';
import { Spinner } from '@workspace/ui/components/spinner';

type Agent = { id: string; displayName: string };

export function Composer({
  onSend,
  disabled,
  sending,
  home = false,
  agents = [],
}: {
  onSend: (message: ChatRequest) => Promise<boolean>;
  disabled: boolean;
  sending: boolean;
  home?: boolean;
  agents?: Agent[];
}) {
  const t = useTranslations('composer');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<ChatRequestMode>('approve_all');
  const [mentionId, setMentionId] = useState<string>();
  const [mentionOpen, setMentionOpen] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const placeholder = t(home ? 'placeholderHome' : 'placeholderManager');
  const canSend = !!text.trim() && !disabled && !sending;
  const mention = agents.find(({ id }) => id === mentionId);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight, 200)}px`;
  }, [text]);

  return (
    <form
      className="flex flex-col gap-2 rounded-2xl border bg-background p-3 shadow-sm focus-within:ring-3 focus-within:ring-ring/30"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!canSend || submitting.current) return;
        submitting.current = true;
        try {
          if (await onSend({ text: text.trim(), mode, mentionAgentId: mention?.id })) {
            setText((value) => (value === text ? '' : value));
            setMentionId(undefined);
          }
        } finally {
          submitting.current = false;
        }
      }}
    >
      <textarea
        ref={areaRef}
        value={text}
        rows={2}
        maxLength={chatMessageMaxLength}
        disabled={disabled}
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
        className="max-h-50 min-h-12 w-full resize-none bg-transparent px-1 text-[15px] outline-none placeholder:text-muted-foreground"
      />
      <div className="flex flex-wrap items-center gap-1">
        <Popover open={mentionOpen} onOpenChange={setMentionOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled || sending || !agents.length}
                aria-label={t('mention')}
              />
            }
          >
            <AtSign />
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="w-72 gap-1 p-1.5">
            <p className="px-2 py-1.5 text-sm font-medium">{t('mention')}</p>
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                onClick={() => {
                  setMentionId(agent.id);
                  setMentionOpen(false);
                  areaRef.current?.focus();
                }}
              >
                <Bot className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{agent.displayName}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
        {mention && (
          <span className="flex min-w-0 items-center gap-1 rounded-md bg-muted py-0.5 pr-0.5 pl-2 text-sm">
            <span className="truncate">{mention.displayName}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={sending}
              aria-label={t('mentionRemove')}
              onClick={() => setMentionId(undefined)}
            >
              <X />
            </Button>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled || sending}
                  aria-label={t('mode')}
                  className="text-muted-foreground"
                />
              }
            >
              {t(`modes.${mode}.label`)}
              <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-72">
              <DropdownMenuRadioGroup value={mode} onValueChange={(value: ChatRequestMode) => setMode(value)}>
                {chatRequestModes.map((item) => (
                  <DropdownMenuRadioItem key={item} value={item} className="items-start">
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">{t(`modes.${item}.label`)}</span>
                      <span className="text-xs text-muted-foreground">{t(`modes.${item}.note`)}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="submit"
            size="icon-sm"
            aria-label={t('send')}
            disabled={!canSend}
            className="rounded-full"
          >
            {sending ? <Spinner /> : <ArrowUp />}
          </Button>
        </div>
      </div>
    </form>
  );
}
