import { redirect } from 'next/navigation';

export default function RoutinesRedirectPage() {
  redirect('/tasks?tab=routines');
}
