'use client';

import { BookOpen, Building2, KeyRound, ListChecks, Lock, Settings2, ShieldCheck, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import type { Workspace } from '@workspace/types';

import { useProject } from '@/entities/project';
import { hasRoleAtLeast, preferredProject, useProjects } from '@/entities/workspace';
import { AccountMembers } from '@/features/manage-members/ui/account-members';
import { GeneralSettings } from '@/features/project-settings/ui/general-settings';
import { JournalSettings } from '@/features/project-settings/ui/journal-settings';
import { KeysSettings } from '@/features/project-settings/ui/keys-settings';
import { PermissionsSettings } from '@/features/project-settings/ui/permissions-settings';
import { RulesSettings } from '@/features/project-settings/ui/rules-settings';
import { SecuritySettings } from '@/features/project-settings/ui/security-settings';
import { OptionSelect } from '@/shared/ui/option-select';
import { SettingsCard } from '@/shared/ui/settings-card';
import { SettingsQueryStatus } from '@/shared/ui/settings-query-status';
import { SectionLayout } from '@/widgets/section-layout';

const tabIcons = {
  general: Building2,
  rules: BookOpen,
  permissions: ShieldCheck,
  members: Users,
  keys: KeyRound,
  journal: ListChecks,
  security: Lock,
  account: Settings2,
};

type Tab = keyof typeof tabIcons;
const tabs = Object.keys(tabIcons) as Tab[];

export function ProjectSettings({
  account,
  accountSettings,
}: {
  account: Workspace;
  accountSettings: ReactNode;
}) {
  const t = useTranslations('projectSettings');
  const router = useRouter();
  const params = useSearchParams();
  const projects = useProjects(account.id);
  const selected = params.get('project');
  const project =
    projects.data?.find(({ id }) => id === selected) ?? preferredProject(projects.data, account.id);
  const canSeeOperations = hasRoleAtLeast(account.role, 'tech');
  const visibleTabs = tabs.filter((tab) => canSeeOperations || (tab !== 'keys' && tab !== 'journal'));
  const tab = visibleTabs.find((tab) => tab === params.get('section')) ?? 'general';

  const href = (section: Tab, projectId?: string) => {
    const query = new URLSearchParams(params);
    if (projectId) query.set('project', projectId);
    else query.delete('project');
    query.set('section', section);
    return `/settings?${query}`;
  };

  return (
    <SectionLayout
      title={t('title')}
      subtitle={project ? t('subtitle', { project: project.name }) : undefined}
      action={
        projects.data && projects.data.length > 1 && project && tab !== 'account' && tab !== 'members' ? (
          <div className="grid w-full max-w-60 gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="settings-project">
              {t('activeProject')}
            </label>
            <OptionSelect
              id="settings-project"
              value={project.id}
              options={projects.data.map(({ id }) => id)}
              label={(id) => projects.data.find((item) => item.id === id)?.name ?? id}
              onChange={(id) => router.replace(href(tab, id), { scroll: false })}
            />
          </div>
        ) : undefined
      }
      nav={visibleTabs.map((item) => ({
        href: href(item, project?.id),
        label: t(`tabs.${item}`),
        icon: tabIcons[item],
        active: tab === item,
      }))}
    >
      {tab === 'account' ? (
        accountSettings
      ) : tab === 'members' ? (
        <AccountMembers account={account} />
      ) : projects.isPending || projects.isError ? (
        <SettingsQueryStatus query={projects} />
      ) : project ? (
        <ProjectSettingsPanel
          key={project.id}
          tab={tab}
          account={account}
          projectId={project.id}
          onDelete={() => router.replace(href('general'), { scroll: false })}
        />
      ) : (
        <SettingsCard title={t('title')}>
          <p className="p-5 text-sm text-muted-foreground">{t('noProject')}</p>
        </SettingsCard>
      )}
    </SectionLayout>
  );
}

function ProjectSettingsPanel({
  tab,
  account,
  projectId,
  onDelete,
}: {
  tab: Exclude<Tab, 'members' | 'account'>;
  account: Workspace;
  projectId: string;
  onDelete: () => void;
}) {
  const query = useProject(account.id, projectId);
  if (query.isPending || query.isError) return <SettingsQueryStatus query={query} />;
  const project = query.data;
  const isAdmin = hasRoleAtLeast(account.role, 'admin');
  const isTech = hasRoleAtLeast(account.role, 'tech');

  switch (tab) {
    case 'general':
      return <GeneralSettings project={project} editable={isAdmin} />;
    case 'rules':
      return <RulesSettings project={project} editable={isTech} />;
    case 'security':
      return <SecuritySettings project={project} role={account.role} onDelete={onDelete} />;
    case 'permissions':
      return <PermissionsSettings project={project} editable={isTech} />;
    case 'keys':
      return isTech ? <KeysSettings project={project} /> : null;
    case 'journal':
      return isTech ? <JournalSettings project={project} /> : null;
  }
}
