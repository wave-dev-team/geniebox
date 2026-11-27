import { getTranslations } from 'next-intl/server';

import { AgentsList } from '@/widgets/agents/ui/agents-list';

export async function generateMetadata() {
  const t = await getTranslations('agentsSection');
  return { title: t('title') };
}

export default function AgentsPage() {
  return <AgentsList />;
}
