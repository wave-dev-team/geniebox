'use client';

import { Check, ChevronDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
  useSidebar,
} from '@workspace/ui/components/sidebar';

import { useWorkspaces } from '@/entities/workspace';
import { AccountMenu } from '@/features/account-menu';
import { footerNavigation, mainNavigation } from '@/shared/config/nav';
import { routes } from '@/shared/config/routes';

function WorkspaceLogo() {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center rounded-md border bg-background text-xs font-semibold"
    >
      G
    </span>
  );
}

function WorkspaceSwitcher({ onSelect }: { onSelect: () => void }) {
  const t = useTranslations();
  const { data, select } = useWorkspaces();
  const selected = data?.workspaces.find(({ id }) => id === data.activeId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('workspace.switch')}
        render={<SidebarMenuButton className="gap-1.5 px-1.5 text-base font-semibold" />}
      >
        <WorkspaceLogo />
        <span className="truncate">{selected?.name ?? t('app.brand')}</span>
        <ChevronDown className="-ml-0.5 size-3.5! opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-68" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="sr-only">{t('workspace.list')}</DropdownMenuLabel>
          {data?.workspaces.map((workspace) => (
            <DropdownMenuItem
              className="min-h-10"
              key={workspace.id}
              onClick={() => {
                onSelect();
                if (workspace.id !== data.activeId) select(workspace.id);
              }}
            >
              <WorkspaceLogo />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{workspace.name}</span>
                <span className="text-xs text-muted-foreground">{t(`workspace.${workspace.role}`)}</span>
              </span>
              {workspace.id === data.activeId ? <Check /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="p-2" render={<Link href={routes.onboarding()} onClick={onSelect} />}>
          <span
            aria-hidden="true"
            className="flex size-6 shrink-0 items-center justify-center rounded-md border"
          >
            <Plus />
          </span>
          <span className="font-medium text-muted-foreground">{t('workspace.addProject')}</span>
        </DropdownMenuItem>
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
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <WorkspaceSwitcher onSelect={closeOnMobile} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={t('nav.sections')}>
          <SidebarGroup>
            <SidebarMenu className="gap-1">
              {mainNavigation.map(({ id, href, icon: Icon }) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton
                    className="px-2 has-[>svg:first-child]:pl-2"
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
        {footerNavigation.length > 0 && (
          <SidebarGroup className="mt-auto">
            <SidebarMenu>
              {footerNavigation.map(({ id, href, icon: Icon }) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton
                    className="px-2 has-[>svg:first-child]:pl-2"
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
                    <span>{t(`sections.${id}`)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <AccountMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
