import { redirect } from 'next/navigation';

export default async function InvitationPage({ searchParams }: PageProps<'/invitations/accept'>) {
  const { token } = await searchParams;
  redirect(typeof token === 'string' ? '/settings?invite=' + encodeURIComponent(token) : '/settings');
}
