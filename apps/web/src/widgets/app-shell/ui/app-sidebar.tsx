'use client';

import { Check, ChevronDown, Pause, Plus, Search } from 'lucide-react';
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
import { Kbd } from '@workspace/ui/components/kbd';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@workspace/ui/components/sidebar';

import { AccountMenu } from '@/features/account-menu';
import { footerNavigation, mainNavigation } from '@/shared/config/nav';

function ProjectLogo() {
  return (
    <span
      aria-hidden="true"
      className="flex size-5.5 shrink-0 items-center justify-center rounded-md border bg-background text-xs font-semibold"
    >
      G
    </span>
  );
}

function ProjectSwitcher() {
  const t = useTranslations();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('project.switch')}
        className="min-w-0 flex-1 px-1.5 font-semibold"
        render={<SidebarMenuButton />}
      >
        <ProjectLogo />
        <span className="truncate">{t('app.brand')}</span>
        <ChevronDown className="-ml-0.5 size-3.5! opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-68" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="sr-only">{t('project.projects')}</DropdownMenuLabel>
          <DropdownMenuItem render={<Link href="/" />} className="min-h-10">
            <ProjectLogo />
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
        <ProjectSwitcher />
        <SidebarTrigger aria-label={t('nav.hideSidebar')} className="size-7 shrink-0" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="sr-only">{t('nav.sections')}</SidebarGroupLabel>
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
                  <span>{id === 'home' ? t('nav.home') : t(`sections.${id}`)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sm font-normal">{t('agents.title')}</SidebarGroupLabel>
          <SidebarGroupAction className="right-8" disabled aria-label={t('agents.pauseTeam')}>
            <Pause />
          </SidebarGroupAction>
          <SidebarGroupAction
            aria-label={t('agents.add')}
            render={<Link href="/marketplace" onClick={closeOnMobile} />}
          >
            <Plus />
          </SidebarGroupAction>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-3">
        <SidebarMenu className="gap-0.5">
          {footerNavigation.map(({ id, href, icon: Icon }) => (
            <SidebarMenuItem key={id}>
              <SidebarMenuButton
                render={
                  <Link
                    href={href}
                    onClick={closeOnMobile}
                    aria-current={pathname === href ? 'page' : undefined}
                  />
                }
                isActive={pathname === href}
              >
                <Icon />
                <span>{t(`nav.${id}`)}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === '/search'}
              render={<Link href="/search" onClick={closeOnMobile} />}
            >
              <Search />
              <span>{t('nav.search')}</span>
            </SidebarMenuButton>
            <Kbd className="pointer-events-none absolute top-1.5 right-1">⌘K</Kbd>
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
