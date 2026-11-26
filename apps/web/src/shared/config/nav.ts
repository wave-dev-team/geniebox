import { BookOpen, Bot, CircleHelp, FileText, House, ListTodo, Plug, Settings } from 'lucide-react';

const workspaceSections = [
  { id: 'tasks', href: '/tasks', icon: ListTodo },
  { id: 'agents', href: '/agents', icon: Bot },
  { id: 'knowledge', href: '/knowledge', icon: BookOpen },
  { id: 'connections', href: '/connections', icon: Plug },
  { id: 'reports', href: '/reports', icon: FileText },
] as const;

export const mainNavigation = [{ id: 'home', href: '/', icon: House }, ...workspaceSections] as const;

export const footerNavigation = [
  { id: 'settings', href: '/settings', icon: Settings },
  { id: 'help', href: '/help', icon: CircleHelp },
] as const;

export const placeholderSections = [
  ...workspaceSections.map(({ id }) => id).filter((id) => id !== 'tasks'),
  ...footerNavigation.map(({ id }) => id),
  'search',
  'hypotheses',
  'releases',
  'sources',
  'backlog',
  'metrics',
  'marketplace',
] as const;
