import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import type { ComponentProps } from 'react';

const markerVariants = cva('flex w-full items-center gap-2 text-xs text-muted-foreground', {
  variants: {
    variant: {
      default: 'py-1',
      separator: 'py-1 before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border',
      border: 'border-b border-border/60 pb-2',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

function Marker({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'div'> & VariantProps<typeof markerVariants>) {
  return <div data-slot="marker" className={cn(markerVariants({ variant }), className)} {...props} />;
}

function MarkerIcon({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="marker-icon"
      className={cn('inline-flex size-3.5 shrink-0 items-center justify-center', className)}
      {...props}
    />
  );
}

function MarkerContent({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="marker-content" className={cn('min-w-0 truncate', className)} {...props} />;
}

export { Marker, MarkerContent, MarkerIcon, markerVariants };
