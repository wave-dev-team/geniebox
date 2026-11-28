import { BookOpen, Bot, ListTodo, type LucideIcon, Settings, WandSparkles } from 'lucide-react';

const workspaceSections = [
  { id: 'tasks', href: '/tasks', icon: ListTodo },
  { id: 'agents', href: '/agents', icon: Bot },
  { id: 'knowledge', href: '/knowledge', icon: BookOpen },
] as const;

export const mainNavigation = [
  { id: 'home', href: '/', icon: WandSparkles },
  ...workspaceSections,
  { id: 'settings', href: '/settings', icon: Settings },
] as const;

export const footerNavigation: readonly { id: 'settings'; href: string; icon: LucideIcon }[] = [];

export const placeholderSections = [
  ...workspaceSections
    .map(({ id }) => id)
    .filter((id) => id !== 'tasks' && id !== 'knowledge' && id !== 'agents'),
  'settings',
  'help',
  'search',
  'hypotheses',
  'releases',
  'sources',
  'backlog',
  'metrics',
  'marketplace',
] as const;
