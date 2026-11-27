'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';

import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@workspace/ui/components/sidebar';
import { cn } from '@workspace/ui/lib/utils';

import { AgentRail } from './agent-rail';
import { AppSidebar } from './app-sidebar';

import { ManagerChatScreen } from '@/widgets/manager-chat/ui/manager-chat-screen';

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
  const t = useTranslations('rail');
  const showRail = pathname !== '/' && pathname !== '/chat';
  const [panel, setPanel] = useState(false);
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
        <ShowSidebarButton />
        <div className="flex-1 overflow-y-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
          {children}
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
