'use client';

import { Check, ChevronDown, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@workspace/ui/components/sidebar';

import { AccountMenu } from '@/features/account-menu';
import { mainNavigation } from '@/shared/config/nav';

function WorkspaceLogo() {
  return (
    <span
      aria-hidden="true"
      className="flex size-5.5 shrink-0 items-center justify-center rounded-md border bg-background text-xs font-semibold"
    >
      G
    </span>
  );
}

function WorkspaceSwitcher({ onSelect }: { onSelect: () => void }) {
  const t = useTranslations();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('workspace.switch')}
        className="min-w-0 flex-1 px-1.5 font-semibold"
        render={<SidebarMenuButton />}
      >
        <WorkspaceLogo />
        <span className="truncate">{t('app.brand')}</span>
        <ChevronDown className="-ml-0.5 size-3.5! opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-68" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="sr-only">{t('workspace.list')}</DropdownMenuLabel>
          <DropdownMenuItem render={<Link href="/" onClick={onSelect} />} className="min-h-10">
            <WorkspaceLogo />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{t('app.brand')}</span>
              <span className="text-xs text-muted-foreground">{t('app.description')}</span>
            </span>
            <Check />
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppSidebar() {
  const t = useTranslations();
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar
      variant="inset"
      collapsible="offcanvas"
      mobileLabel={t('nav.sections')}
      mobileDescription={t('app.description')}
    >
      <SidebarHeader className="flex-row items-center gap-0.5 px-0.5">
        <WorkspaceSwitcher onSelect={closeOnMobile} />
        <SidebarTrigger aria-label={t('nav.hideSidebar')} className="size-7 shrink-0" />
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={t('nav.sections')}>
          <SidebarGroup>
            <SidebarMenu className="gap-0.5">
              {mainNavigation.map(({ id, href, icon: Icon }) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton
                    render={
                      <Link
                        href={href}
                        aria-current={pathname === href ? 'page' : undefined}
                        onClick={closeOnMobile}
                      />
                    }
                    isActive={pathname === href}
                  >
                    <Icon />
                    <span>{t(`sections.${id}`)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter className="gap-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={
                <Link
                  href="/settings"
                  onClick={closeOnMobile}
                  aria-current={pathname === '/settings' ? 'page' : undefined}
                />
              }
              isActive={pathname === '/settings'}
            >
              <Settings />
              <span>{t('sections.settings')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          <SidebarMenuItem>
            <AccountMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
