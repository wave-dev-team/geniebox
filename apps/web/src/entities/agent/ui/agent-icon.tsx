'use client';

import type { AgentIcon as AgentIconDto } from '@workspace/types';
import { cn } from '@workspace/ui/lib/utils';

import { resolveAgentGlyph } from '../lib/icon';

export function AgentIcon({
  icon,
  kind = 'agent',
  className,
  size = 'md',
}: {
  icon?: AgentIconDto | null;
  kind?: 'manager' | 'agent';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const boxSize =
    size === 'sm' ? 'size-7 rounded-md' : size === 'lg' ? 'size-11 rounded-xl' : 'size-9 rounded-lg';
  const glyphSize = size === 'sm' ? 'size-3.5' : size === 'lg' ? 'size-5' : 'size-4';

  if (icon?.kind === 'emoji' && icon.value) {
    return (
      <span
        aria-hidden
        className={cn(
          'inline-flex shrink-0 items-center justify-center bg-muted text-base leading-none',
          boxSize,
          className,
        )}
      >
        {icon.value}
      </span>
    );
  }

  const Glyph = resolveAgentGlyph(icon?.value ?? 'bot', kind);
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center bg-muted text-foreground',
        boxSize,
        className,
      )}
    >
      <Glyph className={glyphSize} />
    </span>
  );
}
