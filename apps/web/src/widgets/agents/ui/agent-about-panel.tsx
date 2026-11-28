'use client';

import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ProjectAgentDetails } from '@workspace/types';
import { Badge } from '@workspace/ui/components/badge';
import { cn } from '@workspace/ui/lib/utils';

const BUILTIN_SKILLS = ['surveys', 'promo', 'ab', 'digest'] as const;

export function AgentAboutPanel({ agent, visible }: { agent: ProjectAgentDetails; visible: boolean }) {
  const t = useTranslations('agentsSection');

  return (
    <div className={cn('space-y-4', !visible && 'hidden lg:block')}>
      <h2 className="text-base font-semibold">{t('detailTabs.about')}</h2>

      {agent.template && (
        <>
          <section className="space-y-2 rounded-xl border bg-card p-4">
            <h3 className="text-sm font-semibold">{t('about.whatDoes')}</h3>
            <p className="text-sm text-muted-foreground">{agent.template.description}</p>
          </section>

          {agent.template.abilities.length > 0 && (
            <section className="space-y-2 rounded-xl border bg-card p-4">
              <h3 className="text-sm font-semibold">{t('about.abilities')}</h3>
              <ul className="space-y-1.5 text-sm">
                {agent.template.abilities.map((ab) => (
                  <li key={ab.name}>
                    <span className="font-medium">{ab.name}</span>
                    {ab.text && <span className="text-muted-foreground"> — {ab.text}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">{t('about.connections')}</h3>
        {agent.connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('about.noConnections')}</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {agent.connections.map((c) => (
              <li key={c.connectionId} className="flex items-center justify-between gap-2">
                <span>
                  {c.name} ({c.providerKey})
                </span>
                <Badge variant="outline" className="text-[11px]">
                  {c.accessLevel} · {c.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {agent.permissions.length > 0 && (
        <section className="space-y-2 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold">{t('about.permissions')}</h3>
          <p className="text-xs text-muted-foreground">{t('about.permissionsHint')}</p>
          <div className="space-y-1.5 pt-1 text-sm">
            {agent.permissions.map((perm) => (
              <div
                key={perm.actionId}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
              >
                <span className="flex items-center gap-1.5 font-mono text-xs">
                  {perm.locked && <Lock className="size-3.5 text-muted-foreground" />}
                  {perm.actionId}
                </span>
                <Badge variant="secondary" className="text-[11px]">
                  {perm.locked ? t('about.lockedBySystem') : t(`permModes.${perm.mode}`)}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      )}

      {Object.keys(agent.limits).length > 0 && (
        <section className="space-y-2 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold">{t('about.limits')}</h3>
          <dl className="space-y-1 text-sm">
            {Object.entries(agent.limits).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {agent.instructions.length > 0 && (
        <section className="space-y-2 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold">{t('about.instructions')}</h3>
          <ul className="space-y-1.5 text-sm">
            {agent.instructions.map((ins, idx) => (
              <li key={idx}>
                <span className="font-medium">{ins.topic}:</span>{' '}
                <span className="text-muted-foreground">{ins.rule}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(agent.asks.length > 0 || agent.enforcedAsks.length > 0) && (
        <section className="space-y-2 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold">{t('about.alwaysAsk')}</h3>
          <div className="flex flex-wrap gap-1.5">
            {agent.enforcedAsks.map((ask) => (
              <Badge key={`enf-${ask}`} variant="default" className="text-xs">
                {ask} ({t('about.projectRule')})
              </Badge>
            ))}
            {agent.asks.map((ask) => (
              <Badge key={ask} variant="outline" className="text-xs">
                {ask}
              </Badge>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">{t('about.notes')}</h3>
        {agent.notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('about.noNotes')}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {agent.notes.slice(0, 5).map((note) => (
              <li key={note.id} className="border-b pb-2 last:border-b-0 last:pb-0">
                <p>{note.text}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(note.createdAt).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">{t('about.skills')}</h3>
        <div className="flex flex-wrap gap-1.5">
          {BUILTIN_SKILLS.map((skill) => (
            <Badge key={skill} variant="outline" className="text-xs">
              {skill}
            </Badge>
          ))}
        </div>
      </section>
    </div>
  );
}
