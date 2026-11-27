import type { LucideIcon } from 'lucide-react';
import { Check, FileText, Folder } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';

import type { KnowledgeNode } from '@/shared/api';

export function NodeIcon({
  kind,
  className = 'size-4',
}: {
  kind: KnowledgeNode['kind'];
  className?: string;
}) {
  const Icon = kind === 'folder' ? Folder : FileText;
  return <Icon aria-hidden="true" className={className} />;
}

export function NodeStatus({ status }: { status: KnowledgeNode['status'] }) {
  const t = useTranslations('knowledge.status');
  return (
    <Badge variant={status === 'draft' ? 'secondary' : 'outline'} className="font-normal">
      {status === 'published' && <Check aria-hidden="true" />}
      {t(status)}
    </Badge>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 px-5 py-10 text-center">
      <div className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        {description && (
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {children && <div className="mt-1 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

export function LoadError({ retry }: { retry: () => void }) {
  const t = useTranslations('knowledge');
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 p-4 text-sm">
      <p>{t('loadError')}</p>
      <Button variant="outline" size="sm" onClick={retry}>
        {t('retry')}
      </Button>
    </div>
  );
}

export function KnowledgeMarkdown({ body }: { body: string }) {
  const t = useTranslations('knowledge');
  if (!body.trim()) return <p className="text-sm text-muted-foreground">{t('emptyBody')}</p>;
  return (
    <div
      className="max-w-full space-y-4 text-sm leading-7 wrap-break-word
      [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-3
      [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground
      [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs
      [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold
      [&_li]:ml-6 [&_ol]:list-decimal [&_ul]:list-disc [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-muted [&_pre]:p-4
      [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:bg-muted [&_th]:p-2 [&_th]:text-left"
    >
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ alt }) => (alt ? <span>{alt}</span> : null),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}
