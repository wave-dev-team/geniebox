import { Button } from '@workspace/ui/components/button';
import { Spinner } from '@workspace/ui/components/spinner';
import { cn } from '@workspace/ui/lib/utils';

/** Save button that sticks to the bottom of long settings forms while there are changes. */
export function SaveBar({
  dirty,
  pending,
  error,
  label,
}: {
  dirty: boolean;
  pending: boolean;
  error?: string;
  label: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-3',
        dirty && 'sticky bottom-4 z-10 rounded-xl border bg-background/95 px-4 py-3 shadow-sm backdrop-blur',
      )}
    >
      {error ? <span className="mr-auto text-sm text-destructive">{error}</span> : null}
      <Button type="submit" disabled={!dirty || pending}>
        {pending ? <Spinner /> : null}
        {label}
      </Button>
    </div>
  );
}
