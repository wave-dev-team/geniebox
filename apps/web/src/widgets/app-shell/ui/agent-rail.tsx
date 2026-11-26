'use client';

import { SquarePen, WandSparkles } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Separator } from '@workspace/ui/components/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip';

export function AgentRail() {
  const t = useTranslations('rail');
  const buttons = [
    { key: 'managerHint', icon: WandSparkles },
    { key: 'newChat', icon: SquarePen },
  ] as const;
  return (
    <aside
      aria-label={t('label')}
      className="hidden w-12 shrink-0 flex-col items-center gap-1 bg-sidebar py-3 text-sidebar-foreground md:flex"
    >
      {buttons.map(({ key, icon: Icon }) => (
        <Tooltip key={key}>
          <TooltipTrigger
            render={
              <Link
                href="/chat"
                aria-label={t(key)}
                className="flex size-8 items-center justify-center rounded-md hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              />
            }
          >
            <Icon className="size-4" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent side="left">{t(key)}</TooltipContent>
        </Tooltip>
      ))}
      <Separator className="my-1.5 w-5! bg-sidebar-border" />
    </aside>
  );
}
