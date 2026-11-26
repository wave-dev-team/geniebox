'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type CSSProperties, type ReactNode, useEffect } from 'react';

import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@workspace/ui/components/sidebar';
import { cn } from '@workspace/ui/lib/utils';

import { AgentRail } from './agent-rail';
import { AppSidebar } from './app-sidebar';

const sidebarStyle = { '--sidebar-width': '15.5rem' } as CSSProperties;

function ShowSidebarButton() {
  const t = useTranslations('nav');
  const { state, isMobile } = useSidebar();
  if (state === 'expanded' && !isMobile) return null;
  return <SidebarTrigger aria-label={t('showSidebar')} className="absolute top-3 left-3 z-10 size-7" />;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const showRail = pathname !== '/';

  useEffect(() => {
    function openSearch(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        router.push('/search');
      }
    }
    window.addEventListener('keydown', openSearch);
    return () => window.removeEventListener('keydown', openSearch);
  }, [router]);

  return (
    <SidebarProvider style={sidebarStyle} className="h-svh overflow-hidden bg-sidebar">
      <AppSidebar />
      <SidebarInset
        className={cn('min-w-0 overflow-hidden', showRail && 'md:peer-data-[variant=inset]:mr-0')}
      >
        <ShowSidebarButton />
        <div className="flex-1 overflow-y-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
          {children}
        </div>
      </SidebarInset>
      {showRail && <AgentRail />}
    </SidebarProvider>
  );
}
