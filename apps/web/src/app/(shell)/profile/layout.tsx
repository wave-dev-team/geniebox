'use client';

import { Bell, Lock, User } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { routes } from '@/shared/config/routes';
import { SectionLayout } from '@/widgets/section-layout';

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('profile');
  return (
    <SectionLayout
      title={t('title')}
      subtitle={t('subtitle')}
      nav={[
        { href: routes.profile(), label: t('tabs.general'), icon: User },
        { href: routes.profile('notifications'), label: t('tabs.notifications'), icon: Bell },
        { href: routes.profile('security'), label: t('tabs.security'), icon: Lock },
      ]}
    >
      {children}
    </SectionLayout>
  );
}
