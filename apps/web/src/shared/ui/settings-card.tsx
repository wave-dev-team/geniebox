import { cn } from '@workspace/ui/lib/utils';

/**
 * Card of the settings and profile screens: a header with title and description, then rows
 * separated by borders (H03, H07, H09).
 */
export function SettingsCard({
  title,
  description,
  action,
  children,
  footer,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('overflow-hidden rounded-xl border bg-card text-card-foreground', className)}>
      <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="font-semibold">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </header>
      {children}
      {footer ? <footer className="flex justify-end gap-2 border-t px-5 py-3">{footer}</footer> : null}
    </section>
  );
}

/** One labelled row of a SettingsCard: label (+ hint) on the left, control on the right. */
export function SettingsRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b px-5 py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </label>
        ) : (
          <span className="text-sm font-medium">{label}</span>
        )}
        {hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2 sm:max-w-[60%]">{children}</div> : null}
    </div>
  );
}
