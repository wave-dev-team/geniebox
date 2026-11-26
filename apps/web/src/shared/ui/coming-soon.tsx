import type { ReactNode } from 'react';

export function ComingSoon({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
      <span aria-hidden="true" className="mb-2 rounded-lg bg-muted p-2 text-muted-foreground">
        {icon}
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
