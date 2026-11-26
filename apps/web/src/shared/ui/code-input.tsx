'use client';

import { InputOTP, InputOTPGroup, InputOTPSlot } from '@workspace/ui/components/input-otp';

/** Six-digit code from an email (sign-in, verification, password reset). */
export function CodeInput({
  id,
  value,
  onChange,
  onComplete,
  invalid,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  return (
    <InputOTP
      id={id}
      maxLength={6}
      pattern={'^\\d+$'}
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      containerClassName="justify-center"
    >
      <InputOTPGroup>
        {Array.from({ length: 6 }, (_, index) => (
          <InputOTPSlot key={index} index={index} className="size-10 text-base" />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
