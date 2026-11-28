import { getTranslations } from 'next-intl/server';

import { AgentDetail } from '@/widgets/agents/ui/agent-detail';

export async function generateMetadata() {
  const t = await getTranslations('agentsSection');
  return { title: t('title') };
}

export default async function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return <AgentDetail agentId={agentId} />;
}
