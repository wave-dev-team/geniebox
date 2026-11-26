import { Bell } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { ComingSoon } from '@/shared/ui/coming-soon';

export default async function NotificationsPage() {
  const t = await getTranslations('profile');
  return <ComingSoon icon={<Bell />} title={t('tabs.notifications')} text={t('notificationsSoon')} />;
}
