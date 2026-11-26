import { getTranslations } from 'next-intl/server';

import { TasksBoard } from '@/widgets/tasks/ui/tasks-board';

export async function generateMetadata() {
  const t = await getTranslations('tasks');
  return { title: t('title') };
}

export default function TasksPage() {
  return <TasksBoard />;
}
