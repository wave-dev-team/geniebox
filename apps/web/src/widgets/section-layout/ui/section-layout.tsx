'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@workspace/ui/lib/utils';

export interface SectionNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Page with a title, a vertical tab list on the left and the tab content on the right
 * (Settings H01–J06, Profile H07–H16). Tabs are links, so each tab has its own URL.
 */
export function SectionLayout({
  title,
  subtitle,
  nav,
  children,
}: {
  title: string;
  subtitle?: string;
  nav: SectionNavItem[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="mx-auto flex w-full max-w-260 flex-col gap-8 px-6 py-10 md:px-10 md:py-14">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </header>
      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        <nav aria-label={title} className="flex shrink-0 gap-1 overflow-x-auto md:w-52 md:flex-col">
          {nav.map((item) => {
            const active = pathname === item.href;
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
        <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
      </div>
    </div>
  );
}
