import { BookOpen, Bot, FileText, ListTodo, Plug, Settings, WandSparkles } from 'lucide-react';

const workspaceSections = [
  { id: 'tasks', href: '/tasks', icon: ListTodo },
  { id: 'agents', href: '/agents', icon: Bot },
  { id: 'knowledge', href: '/knowledge', icon: BookOpen },
  { id: 'connections', href: '/connections', icon: Plug },
  { id: 'reports', href: '/reports', icon: FileText },
] as const;

export const mainNavigation = [{ id: 'home', href: '/', icon: WandSparkles }, ...workspaceSections] as const;

export const footerNavigation = [{ id: 'settings', href: '/settings', icon: Settings }] as const;

export const placeholderSections = [
  ...workspaceSections
    .map(({ id }) => id)
    .filter((id) => id !== 'tasks' && id !== 'knowledge' && id !== 'agents'),
  ...footerNavigation.map(({ id }) => id),
  'help',
  'search',
  'hypotheses',
  'releases',
  'sources',
  'backlog',
  'metrics',
  'marketplace',
] as const;
