import { BookOpen, Bot, FileText, ListTodo, Plug, WandSparkles } from 'lucide-react';

const workspaceSections = [
  { id: 'tasks', href: '/tasks', icon: ListTodo },
  { id: 'agents', href: '/agents', icon: Bot },
  { id: 'knowledge', href: '/knowledge', icon: BookOpen },
  { id: 'connections', href: '/connections', icon: Plug },
  { id: 'reports', href: '/reports', icon: FileText },
] as const;

export const mainNavigation = [
  { id: 'manager', href: '/', icon: WandSparkles },
  ...workspaceSections,
] as const;

export const placeholderSections = [
  ...workspaceSections.map(({ id }) => id),
  'chat',
  'settings',
  'search',
  'billing',
  'help',
  'hypotheses',
  'releases',
  'sources',
  'backlog',
  'metrics',
  'marketplace',
] as const;
