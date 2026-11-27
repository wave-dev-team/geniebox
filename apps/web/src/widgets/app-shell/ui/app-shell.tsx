'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';

import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@workspace/ui/components/sidebar';
import { cn } from '@workspace/ui/lib/utils';

import { AgentRail } from './agent-rail';
import { AppSidebar } from './app-sidebar';

import { AppHeaderTarget } from '@/shared/ui/app-header-slot';
import { ManagerChatScreen } from '@/widgets/manager-chat/ui/manager-chat-screen';

const sidebarStyle = { '--sidebar-width': '18rem' } as CSSProperties;

function SidebarToggle() {
  const t = useTranslations('nav');
  const { open, openMobile, isMobile } = useSidebar();
  const expanded = isMobile ? openMobile : open;
  return (
    <SidebarTrigger
      aria-expanded={expanded}
      aria-label={t(expanded ? 'hideSidebar' : 'showSidebar')}
      className="pointer-events-auto size-7 shrink-0 aria-expanded:not-hover:bg-transparent aria-expanded:not-hover:text-inherit"
    />
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('rail');
  const showRail = pathname !== '/' && pathname !== '/chat';
  const [panel, setPanel] = useState(false);
  const [headerTarget, setHeaderTarget] = useState<HTMLDivElement | null>(null);
  const showPanel = showRail && panel;

  useEffect(() => {
    function openSearch(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        typeof event.key === 'string' &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault();
        router.push('/search');
      }
    }
    window.addEventListener('keydown', openSearch);
    return () => window.removeEventListener('keydown', openSearch);
  }, [router]);

  return (
    <SidebarProvider style={sidebarStyle} className="relative h-svh overflow-hidden bg-sidebar">
      <AppSidebar />
      <SidebarInset
        className={cn('min-w-0 overflow-hidden', showRail && 'md:peer-data-[variant=inset]:mr-0')}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-12 items-center gap-2 px-3 has-[div:not(:empty)]:bg-background">
          <SidebarToggle />
          <div ref={setHeaderTarget} className="min-w-0 flex-1" />
        </div>
        <div className="flex-1 overflow-y-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
          <AppHeaderTarget.Provider value={headerTarget}>{children}</AppHeaderTarget.Provider>
        </div>
      </SidebarInset>
      {showPanel && (
        <aside
          aria-label={t('managerHint')}
          className="absolute inset-y-0 right-12 z-20 my-2 ml-2 hidden w-[min(26rem,calc(100vw-3rem))] shrink-0 overflow-hidden rounded-xl border bg-background shadow-sm md:block lg:static"
        >
          <ManagerChatScreen closePanel={() => setPanel(false)} />
        </aside>
      )}
      {showRail && <AgentRail open={showPanel} onManager={() => setPanel((current) => !current)} />}
    </SidebarProvider>
  );
}
