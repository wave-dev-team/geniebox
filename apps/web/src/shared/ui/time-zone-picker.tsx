'use client';

import { ChevronDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@workspace/ui/components/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@workspace/ui/components/command';
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover';

import { describeTimeZone, timeZoneOptions } from '@/shared/lib/time-zones';

/**
 * Searchable IANA time zone picker. With `nullLabel`, `null` is offered as the first option
 * (the profile uses it for "same as the project").
 */
export function TimeZonePicker({
  id,
  value,
  onChange,
  nullLabel,
  disabled,
}: {
  id?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  nullLabel?: string;
  disabled?: boolean;
}) {
  const t = useTranslations('timezone');
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);
  const options = React.useMemo(() => (open ? timeZoneOptions(locale) : []), [open, locale]);

  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            disabled={disabled}
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            className="w-full min-w-0 max-w-full justify-between gap-1.5 bg-input/50 px-3 text-left font-normal hover:bg-input/50 aria-expanded:bg-input/50 dark:hover:bg-input/50 sm:w-60"
          />
        }
      >
        <span className="min-w-0 flex-1 truncate">
          {value ? describeTimeZone(value, locale) : (nullLabel ?? '')}
        </span>
        <ChevronDown className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        className="max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) rounded-2xl p-0"
        align="start"
        collisionAvoidance={{ fallbackAxisSide: 'none' }}
      >
        <Command className="h-auto min-h-0 rounded-2xl">
          <CommandInput aria-label={t('search')} placeholder={t('search')} className="min-w-0" />
          <CommandList className="min-h-0">
            <CommandEmpty>{t('empty')}</CommandEmpty>
            <CommandGroup>
              {nullLabel ? (
                <CommandItem value="project" onSelect={() => pick(null)} data-checked={value === null}>
                  <span className="min-w-0 flex-1 truncate">{nullLabel}</span>
                </CommandItem>
              ) : null}
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={`${option.id} ${option.city} ${option.offset}`}
                  onSelect={() => pick(option.id)}
                  data-checked={value === option.id}
                >
                  <span className="min-w-0 flex-1 truncate">{option.city}</span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {option.offset}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
