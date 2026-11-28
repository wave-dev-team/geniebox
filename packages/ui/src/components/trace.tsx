'use client';

import { Collapsible } from '@base-ui/react/collapsible';
import { cn } from 'cn';
import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';

function Trace({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="trace"
      className={cn('flex flex-col gap-2 border-l border-border/70 pl-3 text-xs', className)}
      {...props}
    />
  );
}

function TraceLine({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="trace-line" className={cn('flex items-start gap-2', className)} {...props} />;
}

function TraceIcon({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="trace-icon"
      className={cn(
        'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

function TraceTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="trace-title"
      className={cn('min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}

function TraceCollapsible({ className, ...props }: Collapsible.Root.Props) {
  return (
    <Collapsible.Root
      data-slot="trace-collapsible"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  );
}

function TraceCollapsibleTrigger({ className, children, ...props }: Collapsible.Trigger.Props) {
  return (
    <Collapsible.Trigger
      data-slot="trace-collapsible-trigger"
      className={cn(
        'group inline-flex w-fit items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-180" />
    </Collapsible.Trigger>
  );
}

function TraceCollapsibleContent({ className, ...props }: Collapsible.Panel.Props) {
  return (
    <Collapsible.Panel data-slot="trace-collapsible-content" className={cn('pt-1', className)} {...props} />
  );
}

export {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
};
