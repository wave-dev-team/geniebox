import { RequireAuth } from '@/core/auth/auth-gate';
import { InvitationForm } from '@/widgets/project-onboarding/ui/invitation-form';

export default async function InvitationPage({ searchParams }: PageProps<'/invitations/accept'>) {
  const { token } = await searchParams;
  return (
    <RequireAuth>
      <InvitationForm token={typeof token === 'string' ? token : ''} />
    </RequireAuth>
  );
}
