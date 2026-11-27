'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import type { Workspace } from '@workspace/types';
import { buttonVariants } from '@workspace/ui/components/button';
import { cn } from '@workspace/ui/lib/utils';

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
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';
import { SettingsQueryStatus } from '@/shared/ui/settings-query-status';

const tabs = ['general', 'rules', 'security', 'permissions', 'keys', 'journal', 'members'] as const;
type Tab = (typeof tabs)[number];

export function ProjectSettings({ account }: { account: Workspace }) {
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
    <section className="grid gap-4" aria-label={t('title')}>
      <nav className="flex flex-wrap gap-1 rounded-xl border bg-card p-1.5" aria-label={t('title')}>
        {visibleTabs.map((item) => (
          <Link
            key={item}
            href={href(item, project?.id)}
            scroll={false}
            aria-current={tab === item ? 'page' : undefined}
            className={cn(
              buttonVariants({ variant: tab === item ? 'secondary' : 'ghost', size: 'sm' }),
              'shrink-0',
            )}
          >
            {t(`tabs.${item}`)}
          </Link>
        ))}
      </nav>
      {tab === 'members' ? (
        <AccountMembers account={account} />
      ) : (
        <>
          {projects.isPending || projects.isError ? (
            <SettingsQueryStatus query={projects} />
          ) : !project ? (
            <SettingsCard title={t('title')}>
              <p className="p-5 text-sm text-muted-foreground">{t('noProject')}</p>
            </SettingsCard>
          ) : (
            <>
              <SettingsCard title={t('title')}>
                <SettingsRow label={t('activeProject')} htmlFor="settings-project">
                  <OptionSelect
                    id="settings-project"
                    value={project.id}
                    options={projects.data.map(({ id }) => id)}
                    label={(id) => projects.data.find((item) => item.id === id)?.name ?? id}
                    onChange={(id) => router.replace(href(tab, id), { scroll: false })}
                  />
                </SettingsRow>
              </SettingsCard>
              <ProjectSettingsPanel
                key={project.id}
                tab={tab}
                account={account}
                projectId={project.id}
                onDelete={() => router.replace(href('general'), { scroll: false })}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}

function ProjectSettingsPanel({
  tab,
  account,
  projectId,
  onDelete,
}: {
  tab: Exclude<Tab, 'members'>;
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
