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
}: {
  id?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  nullLabel?: string;
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
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal sm:w-60"
          />
        }
      >
        <span className="truncate">{value ? describeTimeZone(value, locale) : (nullLabel ?? '')}</span>
        <ChevronDown className="opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput placeholder={t('search')} />
          <CommandList>
            <CommandEmpty>{t('empty')}</CommandEmpty>
            <CommandGroup>
              {nullLabel ? (
                <CommandItem value="project" onSelect={() => pick(null)} data-checked={value === null}>
                  {nullLabel}
                </CommandItem>
              ) : null}
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={`${option.id} ${option.city} ${option.offset}`}
                  onSelect={() => pick(option.id)}
                  data-checked={value === option.id}
                >
                  <span className="truncate">{option.city}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{option.offset}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
