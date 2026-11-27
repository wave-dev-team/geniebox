'use client';

import { WandSparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip';

export function AgentRail({ open, onManager }: { open: boolean; onManager: () => void }) {
  const t = useTranslations('rail');
  return (
    <aside
      aria-label={t('label')}
      className="hidden w-12 shrink-0 flex-col items-center gap-1 bg-sidebar py-3 text-sidebar-foreground md:flex"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onManager}
              aria-label={t('managerHint')}
              aria-pressed={open}
              className="flex size-8 items-center justify-center rounded-md hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-pressed:bg-sidebar-accent"
            />
          }
        >
          <WandSparkles className="size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="left">{t('managerHint')}</TooltipContent>
      </Tooltip>
    </aside>
  );
}
