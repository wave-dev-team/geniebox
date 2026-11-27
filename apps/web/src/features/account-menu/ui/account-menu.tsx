'use client';

import { EllipsisVertical } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';

import { Avatar, AvatarFallback } from '@workspace/ui/components/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import { SidebarMenuButton } from '@workspace/ui/components/sidebar';
import { Skeleton } from '@workspace/ui/components/skeleton';

import { useChangeLocale } from '../model/use-change-locale';

import { useMe } from '@/entities/session';
import { authApi } from '@/shared/api';
import { isLocale, type Locale, LOCALES } from '@/shared/config/i18n/locales';
import { routes } from '@/shared/config/routes';
import { useErrorMessage } from '@/shared/lib/api-error';
import { initials } from '@/shared/lib/initials';

const LOCALE_NAMES: Record<Locale, string> = { ru: 'Русский', en: 'English' };
const THEMES = ['light', 'dark', 'system'] as const;

/** Account menu at the bottom of the sidebar (K02, K09, K10). */
export function AccountMenu() {
  const t = useTranslations('account');
  const router = useRouter();
  const me = useMe();
  const { theme = 'system', setTheme } = useTheme();
  const { locale, change } = useChangeLocale();
  const errorMessage = useErrorMessage();

  if (!me.data) {
    return <Skeleton className="h-12 w-full" />;
  }

  const name = me.data.displayName ?? me.data.email;
  const themeName = {
    light: t('themeLight'),
    dark: t('themeDark'),
    system: t('themeSystem'),
  } as const;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={t('menu')} className="px-2" render={<SidebarMenuButton size="lg" />}>
        <Avatar className="size-8 rounded-lg">
          <AvatarFallback className="rounded-lg">{initials(name)}</AvatarFallback>
        </Avatar>
        <span className="grid min-w-0 flex-1 text-left leading-tight">
          <span className="truncate font-semibold">{name}</span>
          <span className="truncate text-xs text-muted-foreground">{me.data.email}</span>
        </span>
        <EllipsisVertical className="ml-auto size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="grid leading-tight">
            <span className="truncate font-semibold text-foreground">{name}</span>
            <span className="truncate text-xs font-normal">{me.data.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => router.push(routes.profile())}>{t('profile')}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push(routes.profile('notifications'))}>
            {t('notifications')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {t('theme')}
              <span className="ml-auto text-xs text-muted-foreground">
                {themeName[theme as (typeof THEMES)[number]] ?? themeName.system}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40">
              <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value)}>
                {THEMES.map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {themeName[value]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {t('language')}
              <span className="ml-auto text-xs text-muted-foreground">{LOCALE_NAMES[locale]}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40">
              <DropdownMenuRadioGroup
                value={locale}
                onValueChange={(value) => isLocale(value) && change(value)}
              >
                {LOCALES.map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {LOCALE_NAMES[value]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            try {
              await authApi.logout();
              window.location.replace(routes.login());
            } catch (error) {
              toast.error(errorMessage(error));
            }
          }}
        >
          {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
