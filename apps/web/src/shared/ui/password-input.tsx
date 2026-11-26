'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@workspace/ui/components/input-group';

type PasswordInputProps = Omit<React.ComponentProps<'input'>, 'type'> & {
  /** Accessible label of the toggle while the value is hidden. */
  showLabel?: string;
  /** Accessible label of the toggle while the value is visible. */
  hideLabel?: string;
  /** Classes for the wrapping group; `className` goes to the input itself. */
  groupClassName?: string;
};

/** Password field with an inline show/hide toggle. */
function PasswordInput({
  className,
  groupClassName,
  disabled,
  showLabel,
  hideLabel,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = React.useState(false);
  const t = useTranslations('auth');
  const label = visible ? (hideLabel ?? t('hidePassword')) : (showLabel ?? t('showPassword'));

  return (
    <InputGroup className={groupClassName} data-disabled={disabled || undefined}>
      <InputGroupInput
        type={visible ? 'text' : 'password'}
        disabled={disabled}
        className={className}
        {...props}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={label}
          aria-pressed={visible}
          title={label}
          disabled={disabled}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

export { PasswordInput };
