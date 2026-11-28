import { Injectable } from '@nestjs/common';

export interface DemoIssue {
  id: string;
  key: string;
  title: string;
  description: string;
  status: 'open' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  updatedAt: string;
}

export interface CreateDemoIssueInput {
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
}

export interface UpdateDemoIssueInput {
  title?: string;
  description?: string;
  status?: 'open' | 'in_progress' | 'done';
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
}

const METRIKA_DAYS = [
  { date: '2026-11-21', visits: 4120, users: 3490, bounceRate: 34.2, orders: 124 },
  { date: '2026-11-22', visits: 4280, users: 3610, bounceRate: 33.8, orders: 131 },
  { date: '2026-11-23', visits: 4190, users: 3550, bounceRate: 34.5, orders: 126 },
  { date: '2026-11-24', visits: 4310, users: 3620, bounceRate: 35.1, orders: 129 },
  { date: '2026-11-25', visits: 4250, users: 3580, bounceRate: 46.8, orders: 78 },
  { date: '2026-11-26', visits: 4340, users: 3670, bounceRate: 48.2, orders: 74 },
  { date: '2026-11-27', visits: 4290, users: 3640, bounceRate: 47.9, orders: 76 },
] as const;

const METRIKA_PAGES = [
  { page: '/catalog/kaspersky', visits: 1850, users: 1620, bounceRate: 41.0, orders: 42 },
  { page: '/catalog/astra-linux', visits: 1120, users: 980, bounceRate: 56.4, orders: 11 },
  { page: '/checkout', visits: 690, users: 640, bounceRate: 51.2, orders: 23 },
] as const;

/**
 * Isolated in-memory state for the demonstration sandbox (Yandex Metrika emulator and
 * test backlog). Never touches production tables.
 */
@Injectable()
export class DemoSandboxService {
  private readonly issues: DemoIssue[] = [
    {
      id: 't-08',
      key: 'T-08',
      title: 'Упростить шаг оформления заказа для B2B-подписок',
      description: 'Высокий процент отказов на /checkout и в карточках Astra/Kaspersky после релиза.',
      status: 'open',
      priority: 'high',
      tags: ['checkout', 'b2b'],
      updatedAt: '2026-11-25T10:00:00.000Z',
    },
    {
      id: 't-09',
      key: 'T-09',
      title: 'Обновить описание лицензирования в карточках ПО',
      description: 'Добавить сравнительную таблицу редакций на страницу товара.',
      status: 'in_progress',
      priority: 'medium',
      tags: ['catalog'],
      updatedAt: '2026-11-24T12:00:00.000Z',
    },
  ];
  private nextSeq = 10;

  metrikaData(query: { metrics?: string; dimensions?: string }) {
    const metricKeys = (query.metrics ?? 'ym:s:visits,ym:s:users,ym:s:bounceRate')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const dimKey = (query.dimensions ?? '').split(',')[0]?.trim() || '';

    const pickMetric = (
      row: { visits: number; users: number; bounceRate: number; orders: number },
      key: string,
    ) => {
      if (key.includes('users')) return row.users;
      if (key.includes('bounce')) return row.bounceRate;
      if (key.includes('Purchase') || key.includes('order') || key.includes('goal')) return row.orders;
      return row.visits;
    };

    const totals = metricKeys.map((key) => {
      if (key.includes('bounce')) {
        const avg = METRIKA_DAYS.reduce((sum, d) => sum + d.bounceRate, 0) / METRIKA_DAYS.length;
        return Math.round(avg * 10) / 10;
      }
      return METRIKA_DAYS.reduce((sum, d) => sum + pickMetric(d, key), 0);
    });

    const sourceRows = dimKey.includes('page')
      ? METRIKA_PAGES.map((p) => ({ dim: p.page, row: p }))
      : METRIKA_DAYS.map((d) => ({ dim: d.date, row: d }));

    return {
      query: { metrics: metricKeys, dimensions: dimKey ? [dimKey] : [] },
      totals,
      data: sourceRows.map(({ dim, row }) => ({
        dimensions: dimKey ? [{ name: dim }] : [],
        metrics: metricKeys.map((k) => pickMetric(row, k)),
      })),
    };
  }

  listIssues(): DemoIssue[] {
    return this.issues;
  }

  createIssue(input: CreateDemoIssueInput): DemoIssue {
    const num = this.nextSeq++;
    const issue: DemoIssue = {
      id: `t-${num}`,
      key: `T-${num}`,
      title: input.title,
      description: input.description ?? '',
      status: 'open',
      priority: input.priority ?? 'medium',
      tags: input.tags?.length ? input.tags : ['сгенерирована ИИ-помощником'],
      updatedAt: new Date().toISOString(),
    };
    this.issues.unshift(issue);
    return issue;
  }

  updateIssue(id: string, input: UpdateDemoIssueInput): DemoIssue | undefined {
    const issue = this.issues.find((i) => i.id === id || i.key.toLowerCase() === id.toLowerCase());
    if (!issue) return undefined;
    if (input.title !== undefined) issue.title = input.title;
    if (input.description !== undefined) issue.description = input.description;
    if (input.status !== undefined) issue.status = input.status;
    if (input.priority !== undefined) issue.priority = input.priority;
    if (input.tags !== undefined) issue.tags = input.tags;
    issue.updatedAt = new Date().toISOString();
    return issue;
  }
}
