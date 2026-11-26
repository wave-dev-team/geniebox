import { Send } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { ComingSoon } from '@/shared/ui/coming-soon';

export default async function TelegramPage() {
  const t = await getTranslations();
  return <ComingSoon icon={<Send />} title={t('profile.tabs.telegram')} text={t('app.placeholder')} />;
}
