import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';

import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { Input } from '@workspace/ui/components/input';

import { ancestors, type Knowledge } from '../model/knowledge';
import { EmptyState, LoadError, NodeIcon, NodeStatus } from './knowledge-ui';

import type { KnowledgeNode } from '@/shared/api';

function Highlight({ text, query }: { text: string; query: string }) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'giu'));
  return parts.map((part, index) =>
    index % 2 ? (
      <mark key={index} className="rounded-sm bg-primary/15 text-inherit">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function KnowledgeSearch({
  knowledge,
  nodes,
  byId,
  onClose,
  onOpen,
}: {
  knowledge: Knowledge;
  nodes: KnowledgeNode[];
  byId: Map<string, KnowledgeNode>;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations('knowledge');
  const locale = useLocale();
  const id = useId();
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState('');
  const query = input.trim();
  useEffect(() => {
    const timer = window.setTimeout(() => setSubmitted(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const search = useQuery({
    queryKey: [...knowledge.keys.search, submitted],
    queryFn: ({ signal }) => knowledge.api.search(submitted, signal),
    enabled: Boolean(submitted),
  });
  const serverMatches = submitted === query ? (search.data?.items ?? []) : [];
  const matchedIds = new Set(serverMatches.map((item) => item.nodeId));
  const normalized = query.toLocaleLowerCase(locale);
  const titles = query
    ? nodes
        .filter(
          (node) => !matchedIds.has(node.id) && node.title.toLocaleLowerCase(locale).includes(normalized),
        )
        .sort(
          (a, b) =>
            Number(b.title.toLocaleLowerCase(locale).startsWith(normalized)) -
              Number(a.title.toLocaleLowerCase(locale).startsWith(normalized)) ||
            a.title.localeCompare(b.title, locale),
        )
        .slice(0, 10)
    : [];
  const pending = Boolean(query) && (query !== submitted || search.isPending);
  const failed = Boolean(query) && query === submitted && search.isError;
  const results = [
    ...serverMatches.map((result) => ({
      id: result.nodeId,
      title: result.title,
      snippet: result.snippet,
      heading: result.headingPath.filter((part) => part !== result.title).join(' / '),
      sources: result.sources,
    })),
    ...titles.map((node) => ({
      id: node.id,
      title: node.title,
      snippet: '',
      heading: '',
      sources: [],
    })),
  ];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[min(85dvh,44rem)] grid-rows-[auto_auto_minmax(0,1fr)] gap-4 sm:max-w-xl"
      >
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <DialogTitle className="pt-1">{t('search')}</DialogTitle>
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('close')}
            </Button>
          </div>
          <DialogDescription>{t('searchHint')}</DialogDescription>
        </DialogHeader>
        <form
          className="relative"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(query);
          }}
        >
          <Search
            className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <label htmlFor={id} className="sr-only">
            {t('search')}
          </label>
          <Input
            id={id}
            type="search"
            autoFocus
            maxLength={200}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-10 pl-9"
          />
        </form>
        <div className="min-h-0 overflow-y-auto overscroll-contain" aria-busy={pending}>
          {pending && (
            <p role="status" className="px-2 py-3 text-sm text-muted-foreground">
              {t('searching')}
            </p>
          )}
          {failed && <LoadError retry={() => void search.refetch()} />}
          {query && !pending && !failed && !results.length && (
            <EmptyState icon={Search} title={t('nothingFound')} description={t('nothingFoundHint')} />
          )}
          {results.length > 0 && (
            <ul className="divide-y">
              {results.map((result) => {
                const node = byId.get(result.id);
                const path = ancestors(node?.parentId ?? null, byId)
                  .map(({ title }) => title)
                  .join(' / ');
                return (
                  <li key={result.id} className="p-1">
                    <Button
                      variant="ghost"
                      className="h-auto min-h-11 w-full items-start justify-start rounded-lg p-2.5 text-left leading-normal whitespace-normal"
                      onClick={() => {
                        onOpen(result.id);
                      }}
                    >
                      <NodeIcon
                        kind={node?.kind ?? 'page'}
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 space-y-1 wrap-anywhere">
                        <span className="flex flex-wrap items-center gap-2">
                          <span>
                            <Highlight text={result.title} query={query} />
                          </span>
                          {node?.kind === 'page' && <NodeStatus status={node.status} />}
                        </span>
                        {(path || result.heading) && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {[path, result.heading].filter(Boolean).join(' · ')}
                          </span>
                        )}
                        {result.snippet && (
                          <span className="line-clamp-3 font-normal text-muted-foreground">
                            <Highlight text={result.snippet} query={query} />
                          </span>
                        )}
                        {result.sources.map((source) => (
                          <span key={source.id} className="block text-xs font-normal text-muted-foreground">
                            {source.title}
                            {(source.periodStart || source.periodEnd) &&
                              ` · ${t('sourcePeriod', { start: source.periodStart ?? '—', end: source.periodEnd ?? '—' })}`}
                            {source.limitations.length > 0 && ` · ${source.limitations.join(' · ')}`}
                          </span>
                        ))}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
