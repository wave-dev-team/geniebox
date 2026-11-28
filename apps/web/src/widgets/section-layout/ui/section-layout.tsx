'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { cn } from '@workspace/ui/lib/utils';

export interface SectionNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
}

/**
 * Page with a title, a vertical tab list on the left and the tab content on the right
 * (Settings H01–J06, Profile H07–H16). Tabs are links, so each tab has its own URL.
 */
export function SectionLayout({
  title,
  subtitle,
  action,
  nav,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  nav: SectionNavItem[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="@container/section-layout mx-auto flex w-full max-w-260 flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-10 lg:px-10 lg:py-14">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle ? <p className="text-sm break-words text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      <div className="flex flex-col gap-6 @min-[48rem]/section-layout:flex-row @min-[48rem]/section-layout:gap-8">
        {nav.length > 0 && (
          <nav
            aria-label={title}
            className="flex shrink-0 gap-1 overflow-x-auto @min-[48rem]/section-layout:w-52 @min-[48rem]/section-layout:flex-col"
          >
            {nav.map((item) => {
              const active = item.active ?? pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm whitespace-nowrap text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                    active && 'bg-accent font-medium text-accent-foreground',
                  )}
                >
                  <item.icon className="size-4 shrink-0" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
      </div>
    </div>
  );
}
