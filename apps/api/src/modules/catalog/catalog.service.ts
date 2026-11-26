import type { Redis } from 'ioredis';
import { sql } from 'kysely';

import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { CACHE_REDIS } from '../../common/redis/redis.module.js';
import { SystemDb } from '../../database/system-db.js';
import { findTool, type PermissionMode, presetMode } from '../agents/catalog/catalog.js';
import { setTemplateTitles } from '../agents/catalog/titles.js';
import {
  type TemplateCategory,
  type TemplateContent,
  templateContentSchema,
  textsFor,
} from './catalog-content.js';

/** Other processes reload their copy when a template changes (publish, rollback, unpublish). */
export const CATALOG_CHANNEL = 'geniebox:catalog:changed';
const REFRESH_MS = 60_000;

export interface CatalogTemplate {
  id: string;
  key: string;
  category: TemplateCategory;
  icon: string;
  availability: 'none' | 'all' | 'beta';
  betaAccountIds: string[];
  publishedVersionId: string | null;
  unpublishedAt: Date | null;
}

export interface CatalogVersion {
  versionId: string;
  templateId: string;
  key: string;
  number: number;
  category: TemplateCategory;
  icon: string;
  content: TemplateContent;
}

/**
 * The marketplace catalog as the app and the worker see it: published versions and
 * every version an agent is pinned to, kept in memory. Writes happen only through this service
 * (system role), which calls `changed()`; the copy also refreshes every minute.
 */
@Injectable()
export class CatalogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CatalogService.name);
  private templatesByKey = new Map<string, CatalogTemplate>();
  private versionsById = new Map<string, CatalogVersion>();
  private subscriber: Redis | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    // The catalog is platform data, not tenant data; agents are read for pinned version ids only.
    private readonly systemDb: SystemDb,
    @Inject(CACHE_REDIS) private readonly redis: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.safeRefresh(), REFRESH_MS);
    this.timer.unref();
    this.subscriber = this.redis.duplicate({ connectionName: 'geniebox:catalog' });
    this.subscriber.on('message', () => void this.safeRefresh());
    // Not awaited: an unreachable cache Redis must not hold the process start; the minute
    // refresh still keeps the copy current.
    void this.subscriber.subscribe(CATALOG_CHANNEL).catch((error: unknown) => {
      this.logger.warn({ err: error }, 'Catalog change channel unavailable; minute refresh only');
    });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.subscriber?.disconnect();
  }

  /** Reload now and tell the other processes. */
  async changed(): Promise<void> {
    await this.refresh();
    // Fire and forget, like the subscription: the other processes catch up within a minute.
    void this.redis.publish(CATALOG_CHANNEL, String(Date.now())).catch(() => 0);
  }

  async refresh(): Promise<void> {
    const { templates, versions } = await this.systemDb.transaction(async (trx) => {
      const templates = await trx
        .selectFrom('agent_templates')
        .selectAll()
        .orderBy('created_at')
        .orderBy('key')
        .execute();
      const versions = await sql<{
        id: string;
        template_id: string;
        number: number;
        content: unknown;
      }>`
        SELECT v.id, v.template_id, v.number, v.content FROM agent_template_versions v
        WHERE v.state IN ('published', 'previous')
           OR v.id IN (SELECT DISTINCT a.template_version_id FROM agents a
                       WHERE a.template_version_id IS NOT NULL AND a.deleted_at IS NULL)
      `.execute(trx);
      return { templates, versions: versions.rows };
    });
    const byId = new Map(templates.map((t) => [t.id, t]));
    const nextTemplates = new Map<string, CatalogTemplate>();
    for (const t of templates) {
      nextTemplates.set(t.key, {
        id: t.id,
        key: t.key,
        category: t.category as TemplateCategory,
        icon: t.icon,
        availability: t.availability as CatalogTemplate['availability'],
        betaAccountIds: t.beta_account_ids,
        publishedVersionId: t.published_version_id,
        unpublishedAt: t.unpublished_at,
      });
    }
    const nextVersions = new Map<string, CatalogVersion>();
    for (const v of versions) {
      const template = byId.get(v.template_id);
      const parsed = templateContentSchema.safeParse(v.content);
      if (!template || !parsed.success) {
        this.logger.error({ versionId: v.id }, 'Catalog version skipped: invalid content');
        continue;
      }
      nextVersions.set(v.id, {
        versionId: v.id,
        templateId: v.template_id,
        key: template.key,
        number: v.number,
        category: template.category as TemplateCategory,
        icon: template.icon,
        content: parsed.data,
      });
    }
    this.templatesByKey = nextTemplates;
    this.versionsById = nextVersions;
    const titles = new Map<string, { ru: string; en: string }>();
    for (const template of nextTemplates.values()) {
      const version = template.publishedVersionId ? nextVersions.get(template.publishedVersionId) : undefined;
      if (version) {
        titles.set(template.key, {
          ru: textsFor(version.content, 'ru').name,
          en: textsFor(version.content, 'en').name,
        });
      }
    }
    setTemplateTitles(titles);
  }

  private async safeRefresh(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      this.logger.warn({ err: error }, 'Catalog refresh failed; keeping the previous copy');
    }
  }

  templates(): CatalogTemplate[] {
    return [...this.templatesByKey.values()];
  }

  template(key: string): CatalogTemplate | undefined {
    return this.templatesByKey.get(key);
  }

  /** The current published version of a template (also for one taken down: hired agents run). */
  published(key: string): CatalogVersion | undefined {
    const template = this.templatesByKey.get(key);
    return template?.publishedVersionId ? this.versionsById.get(template.publishedVersionId) : undefined;
  }

  version(id: string): CatalogVersion | undefined {
    return this.versionsById.get(id);
  }

  /** The version an agent runs on; before pinning (or if missing) — the published one. */
  forAgent(agent: {
    templateKey: string | null;
    templateVersionId: string | null;
  }): CatalogVersion | undefined {
    if (!agent.templateKey) return undefined;
    return (
      (agent.templateVersionId ? this.versionsById.get(agent.templateVersionId) : undefined) ??
      this.published(agent.templateKey)
    );
  }

  /** In the marketplace of this account: published for all, or a beta the account is in. */
  listedFor(key: string, accountId: string | null): boolean {
    const template = this.templatesByKey.get(key);
    if (!template?.publishedVersionId) return false;
    if (template.availability === 'all') return true;
    return (
      template.availability === 'beta' && accountId !== null && template.betaAccountIds.includes(accountId)
    );
  }
}

/**
 * Default mode of a catalog tool for an agent: the version's setting for the agent's trust
 * level, else the risk-class rule. A system-denied tool is always «deny».
 */
export function versionMode(
  version: CatalogVersion | undefined,
  toolId: string,
  trust: string,
): PermissionMode {
  const tool = findTool(toolId);
  if (!tool || tool.systemDenied) return 'deny';
  const setting = version?.content.tools.find((t) => t.id === toolId);
  const mode = setting?.modes[trust as keyof typeof setting.modes];
  return mode ?? presetMode(trust, tool.risk);
}

/** Catalog tools of a version: the configured ones plus the system-denied («Никогда»). */
export function versionToolIds(version: CatalogVersion): string[] {
  return version.content.tools.map((tool) => tool.id);
}
