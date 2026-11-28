import { ConnectLinkForm } from '@/features/project-settings/ui/connect-link-form';

export default async function ConnectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ConnectLinkForm token={token} />;
}
