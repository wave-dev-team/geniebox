import { placeholderSections } from './nav';

export function safeNextPath(value: string | null | undefined): string | undefined {
  if (!value?.startsWith('/') || /[\\\u0000-\u0020]|^\/\//.test(value)) return undefined;
  const base = 'https://geniebox.invalid';
  const target = new URL(value, base);
  const allowed = [
    '/profile',
    '/onboarding',
    '/chat',
    '/invitations/accept',
    '/routines',
    '/tasks',
    '/agents',
    ...placeholderSections.map((section) => `/${section}`),
  ];
  return target.origin === base &&
    (target.pathname === '/' ||
      allowed.some((path) => target.pathname === path || target.pathname.startsWith(path + '/')))
    ? target.pathname + target.search + target.hash
    : undefined;
}

const withNext = (path: string, next?: string) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);

type ProfileTab = 'general' | 'notifications' | 'security';

export const routes = {
  root: () => '/',
  chat: (project?: string, conversation?: string) => {
    if (!project) return '/chat';
    const params = new URLSearchParams({ project });
    if (conversation) params.set('conversation', conversation);
    return '/chat?' + params;
  },
  onboarding: (slug?: string) => (slug ? '/onboarding/' + encodeURIComponent(slug) : '/onboarding'),
  invitation: (token?: string) =>
    token ? '/invitations/accept?token=' + encodeURIComponent(token) : '/invitations/accept',
  tasks: (id?: string) => (id ? `/tasks?task=${encodeURIComponent(id)}` : '/tasks'),
  agents: (id?: string) => (id ? `/agents/${encodeURIComponent(id)}` : '/agents'),
  login: (next?: string) => withNext('/login', next),
  signup: (next?: string) => withNext('/signup', next),
  resetPassword: (next?: string) => withNext('/reset-password', next),
  verifyEmail: (next?: string) => withNext('/verify-email', next),
  profile: (tab: ProfileTab = 'general') => (tab === 'general' ? '/profile' : `/profile/${tab}`),
} as const;
