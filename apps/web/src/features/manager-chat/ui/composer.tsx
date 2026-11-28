'use client';

import { ArrowUp, AtSign, Bot, ChevronDown, FileText, Paperclip, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

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
  onAttachFile,
  disabled,
  sending,
  home = false,
  agents = [],
}: {
  onSend: (message: ChatRequest) => Promise<boolean>;
  onAttachFile?: (file: File) => Promise<{ name: string }>;
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
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const placeholder = t(home ? 'placeholderHome' : 'placeholderManager');
  const canSend = (!!text.trim() || attachedFiles.length > 0) && !disabled && !sending && !attaching;
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
          const prefix = attachedFiles.length
            ? `${attachedFiles.map((name) => t('attachedPrefix', { name })).join('\n')}\n`
            : '';
          const payloadText = `${prefix}${text.trim()}`.trim();
          if (await onSend({ text: payloadText, mode, mentionAgentId: mention?.id })) {
            setText((value) => (value === text ? '' : value));
            setMentionId(undefined);
            setAttachedFiles([]);
          }
        } finally {
          submitting.current = false;
        }
      }}
    >
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {attachedFiles.map((name, index) => (
            <div
              key={`${name}-${index}`}
              className="flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1 text-xs"
            >
              <FileText className="size-3.5 text-muted-foreground" />
              <span className="max-w-56 truncate">{name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('attachRemove')}
                onClick={() => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== index))}
                className="size-4 rounded-full p-0 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
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
        {onAttachFile && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".md,.txt,.csv,.xlsx"
              className="hidden"
              onChange={async (event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                if (!files.length) return;
                setAttaching(true);
                const uploadedNames: string[] = [];
                try {
                  for (const file of files) {
                    try {
                      const uploaded = await onAttachFile(file);
                      uploadedNames.push(uploaded.name);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : t('attachError'));
                    }
                  }
                  if (uploadedNames.length) {
                    setAttachedFiles((prev) => [...prev, ...uploadedNames]);
                  }
                } finally {
                  setAttaching(false);
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || sending || attaching}
              aria-label={t('attachFile')}
              onClick={() => fileInputRef.current?.click()}
            >
              {attaching ? <Spinner /> : <Paperclip />}
            </Button>
          </>
        )}
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
