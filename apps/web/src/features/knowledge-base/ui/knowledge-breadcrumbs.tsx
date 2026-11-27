import { ChevronRight, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { MouseEventHandler } from 'react';

import { Button } from '@workspace/ui/components/button';
import { cn } from '@workspace/ui/lib/utils';

import type { KnowledgeNode } from '@/shared/api';
import { AppHeaderSlot } from '@/shared/ui/app-header-slot';

export function KnowledgeBreadcrumbs({
  selected,
  parents,
  currentTitle,
  locked,
  onRoot,
  onOpen,
  onSearch,
}: {
  selected: boolean;
  parents: KnowledgeNode[];
  currentTitle?: string;
  locked: boolean;
  onRoot: () => void;
  onOpen: (id: string) => void;
  onSearch: MouseEventHandler<HTMLButtonElement>;
}) {
  const t = useTranslations('knowledge');

  return (
    <AppHeaderSlot>
      <div className="pointer-events-auto flex min-w-0 items-center gap-2">
        {selected ? (
          <nav aria-label={t('location')} className="min-w-0 flex-1">
            <ol className="flex min-w-0 items-center gap-0.5 text-sm sm:gap-1">
              <li className="shrink-0">
                <Button variant="ghost" size="sm" disabled={locked} onClick={onRoot}>
                  {t('title')}
                </Button>
              </li>
              {parents.map((item, index) => (
                <li
                  key={item.id}
                  className={cn(
                    'min-w-0 items-center gap-1',
                    index === parents.length - 1 ? 'flex' : 'hidden sm:flex',
                  )}
                >
                  <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={locked}
                    title={item.title}
                    onClick={() => onOpen(item.id)}
                    className="block min-w-0 max-w-36 truncate"
                  >
                    {item.title}
                  </Button>
                </li>
              ))}
              {currentTitle && (
                <li className="flex min-w-0 items-center gap-1 pr-1">
                  <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
                  <span aria-current="page" className="truncate text-muted-foreground" title={currentTitle}>
                    {currentTitle}
                  </span>
                </li>
              )}
            </ol>
          </nav>
        ) : (
          <span className="flex-1" />
        )}
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label={t('search')}
          title={t('searchButton')}
          disabled={locked}
          onClick={onSearch}
        >
          <Search aria-hidden="true" />
        </Button>
      </div>
    </AppHeaderSlot>
  );
}
