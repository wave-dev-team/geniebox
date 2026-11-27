import { getTranslations } from 'next-intl/server';

import { ManagerChatScreen } from '@/widgets/manager-chat/ui/manager-chat-screen';

export async function generateMetadata() {
  const t = await getTranslations('managerChat');
  return { title: t('title') };
}

export default function ChatPage() {
  return <ManagerChatScreen />;
}
