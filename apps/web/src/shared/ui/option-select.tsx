'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';

/** Select over a fixed list of values with translated labels (settings rows). */
export function OptionSelect<T extends string | number>({
  id,
  ariaLabel,
  value,
  options,
  label,
  onChange,
  disabled,
  placeholder,
  className,
}: {
  id?: string;
  ariaLabel?: string;
  value: T | null;
  options: readonly T[];
  label: (value: T) => string;
  onChange: (value: T) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Select
      value={value === null ? null : String(value)}
      disabled={disabled}
      onValueChange={(next) => {
        const match = options.find((option) => String(option) === next);
        if (match !== undefined) onChange(match);
      }}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className={className ?? 'w-full sm:w-60'}>
        <SelectValue placeholder={placeholder}>
          {(current: string | null) => {
            const match = options.find((option) => String(option) === current);
            return match === undefined ? placeholder : label(match);
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={String(option)} value={String(option)}>
            {label(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
