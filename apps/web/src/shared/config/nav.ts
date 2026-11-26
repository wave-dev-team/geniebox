import {
  ChartLine,
  CircleHelp,
  House,
  LayoutGrid,
  ListTodo,
  Plug,
  Settings,
  TrendingUp,
  Workflow,
} from 'lucide-react';

export const mainNavigation = [
  { id: 'home', href: '/', icon: House },
  { id: 'hypotheses', href: '/hypotheses', icon: ListTodo },
  { id: 'releases', href: '/releases', icon: TrendingUp },
  { id: 'sources', href: '/sources', icon: Plug },
  { id: 'backlog', href: '/backlog', icon: Workflow },
  { id: 'metrics', href: '/metrics', icon: ChartLine },
  { id: 'marketplace', href: '/marketplace', icon: LayoutGrid },
] as const;

export const footerNavigation = [
  { id: 'settings', href: '/settings', icon: Settings },
  { id: 'help', href: '/help', icon: CircleHelp },
] as const;

export const placeholderSections = [
  'hypotheses',
  'releases',
  'sources',
  'backlog',
  'metrics',
  'chat',
  'settings',
  'help',
  'search',
  'marketplace',
  'billing',
] as const;
