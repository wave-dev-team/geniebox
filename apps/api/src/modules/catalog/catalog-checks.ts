import { createHash } from 'node:crypto';

import { findTool, LIMIT_KINDS, type PermissionMode } from '../agents/catalog/catalog.js';
import { type TemplateContent, TRUST_LEVELS } from './catalog-content.js';
import {
  ASK_TITLES,
  LIMIT_TITLES,
  MODE_TITLES,
  MODEL_TITLES,
  PLAN_TITLES,
  TOOL_TITLES,
  TRUST_TITLES,
} from './catalog-labels.js';

/** Share of scenarios that must pass before publishing. */
export const SCENARIO_PASS_SHARE = 0.9;

export interface ReviewState {
  requestedBy: string | null;
  requestedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  contentHash: string | null;
}

export interface ScenarioResult {
  id: string;
  pass: boolean;
  reason: string;
}

export interface ScenarioRun {
  contentHash: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  by: string;
  results: ScenarioResult[];
}

export type CheckKey = 'card' | 'prompt' | 'risk' | 'data' | 'scenarios' | 'review';

export interface CheckItem {
  key: CheckKey;
  ok: boolean;
  /** The review is required only for a high-risk change; the others always. */
  required: boolean;
  passed?: number;
  total?: number;
}

export interface Checklist {
  items: CheckItem[];
  ready: boolean;
  /** Required items still open: «Перед публикацией: 3 пункта». */
  missing: number;
}

const STRICTNESS: Record<PermissionMode, number> = { auto: 0, notify: 1, approve: 2, deny: 3 };

/**
 * A high-risk tool turned on, or one of its modes made softer, compared with the published
 * version: a second administrator has to approve before publishing.
 */
export function needsReview(published: TemplateContent | null, draft: TemplateContent): boolean {
  for (const tool of draft.tools) {
    if (findTool(tool.id)?.risk !== 'high') continue;
    const before = published?.tools.find((t) => t.id === tool.id);
    if (!before) return true;
    for (const trust of TRUST_LEVELS) {
      if (STRICTNESS[tool.modes[trust]] < STRICTNESS[before.modes[trust]]) return true;
    }
  }
  return false;
}

export function scenarioScore(
  run: ScenarioRun | null,
  contentHash: string,
  total: number,
): { passed: number; total: number; current: boolean } {
  const current = Boolean(run && run.status === 'done' && run.contentHash === contentHash);
  const passed = current ? run!.results.filter((r) => r.pass).length : 0;
  return { passed, total, current };
}

export function checklist(input: {
  content: TemplateContent;
  contentHash: string;
  published: TemplateContent | null;
  review: ReviewState | null;
  scenarioRun: ScenarioRun | null;
}): Checklist {
  const { content } = input;
  const ru = content.texts.ru;
  const card = Boolean(ru.name && ru.short && ru.description) && content.price >= 0;
  const prompt = content.prompt.trim().length > 0;
  const risk = content.tools.every(
    (tool) => findTool(tool.id)?.risk !== 'high' || TRUST_LEVELS.every((t) => tool.modes[t] !== 'auto'),
  );
  const groupsHaveServices = content.requirements.every((r) => r.providers.length > 0);
  const covered = content.tools.every((tool) => {
    const providers = findTool(tool.id)?.providers;
    if (!providers?.length) return true;
    return content.requirements.some((r) => r.providers.some((p) => providers.includes(p)));
  });
  const data = groupsHaveServices && covered;
  const score = scenarioScore(input.scenarioRun, input.contentHash, content.scenarios.length);
  const scenarios = score.total > 0 && score.current && score.passed / score.total >= SCENARIO_PASS_SHARE;
  const reviewRequired = needsReview(input.published, content);
  const reviewOk = Boolean(input.review?.approvedBy && input.review.contentHash === input.contentHash);
  const items: CheckItem[] = [
    { key: 'card', ok: card, required: true },
    { key: 'prompt', ok: prompt, required: true },
    { key: 'risk', ok: risk, required: true },
    { key: 'data', ok: data, required: true },
    {
      key: 'scenarios',
      ok: scenarios,
      required: true,
      passed: score.passed,
      total: score.total,
    },
    { key: 'review', ok: reviewOk, required: reviewRequired },
  ];
  const missing = items.filter((item) => item.required && !item.ok).length;
  return { items, ready: missing === 0, missing };
}

/** Gradual rollout: whether an agent is inside the first `stage` percent (stable per agent). */
export function inRollout(agentId: string, stage: number): boolean {
  if (stage >= 100) return true;
  const bucket = createHash('md5').update(agentId).digest().readUInt32BE(0) % 100;
  return bucket < stage;
}

// --- Diff -------------------------------------------------------------------------------------

export type DiffSectionKey = 'card' | 'prompt' | 'tools' | 'data' | 'limits' | 'asks' | 'scenarios';

export interface DiffSection {
  section: DiffSectionKey;
  kind: 'added' | 'changed' | 'removed';
  lines: string[];
  /** For the prompt: line counts. */
  added?: number;
  removed?: number;
}

const SECTION_TITLES: Record<DiffSectionKey, string> = {
  card: 'Карточка',
  prompt: 'Промпт',
  tools: 'Полномочия',
  data: 'Данные',
  limits: 'Лимиты',
  asks: 'Всегда спрашивать',
  scenarios: 'Сценарии',
};

const rub = (value: number) => `${value.toLocaleString('ru-RU')} ₽`;

function limitText(kind: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  const def = LIMIT_KINDS[kind as keyof typeof LIMIT_KINDS];
  if (typeof value === 'number') return def?.unit === 'rub' ? rub(value) : String(value);
  return typeof value === 'string' ? value : '—';
}

function section(
  key: DiffSectionKey,
  lines: Array<{ sign: '+' | '-' | '~'; text: string }>,
  extra: Partial<DiffSection> = {},
): DiffSection[] {
  if (!lines.length && !extra.added && !extra.removed) return [];
  const plus = lines.filter((l) => l.sign === '+').length + (extra.added ?? 0);
  const minus = lines.filter((l) => l.sign === '-').length + (extra.removed ?? 0);
  const changed = lines.some((l) => l.sign === '~');
  const kind = changed || (plus && minus) ? 'changed' : plus ? 'added' : 'removed';
  return [
    {
      section: key,
      kind,
      lines: lines.map((l) => (l.sign === '~' ? l.text : `${l.sign === '+' ? '+' : '−'} ${l.text}`)),
      ...extra,
    },
  ];
}

/** Lines added and removed between two texts (longest common subsequence). */
export function lineDiff(before: string, after: string): { added: string[]; removed: string[] } {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const added: string[] = [];
  const removed: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      removed.push(a[i++]!);
    } else {
      added.push(b[j++]!);
    }
  }
  while (i < n) removed.push(a[i++]!);
  while (j < m) added.push(b[j++]!);
  return {
    added: added.filter((line) => line.trim()),
    removed: removed.filter((line) => line.trim()),
  };
}

/** What changes for projects between two versions, section by section. */
export function diffContent(before: TemplateContent | null, after: TemplateContent): DiffSection[] {
  const prev = before;
  const out: DiffSection[] = [];

  // Card
  const card: Array<{ sign: '+' | '-' | '~'; text: string }> = [];
  const textFields: Array<[keyof TemplateContent['texts']['ru'], string]> = [
    ['name', 'Название'],
    ['role', 'Роль'],
    ['short', 'Коротко'],
    ['description', 'Описание'],
  ];
  for (const lang of ['ru', 'en'] as const) {
    const a = prev?.texts[lang];
    const b = after.texts[lang];
    for (const [field, title] of textFields) {
      const va = (a?.[field] as string | undefined) ?? '';
      const vb = (b?.[field] as string | undefined) ?? '';
      if (va !== vb) {
        const label = lang === 'en' ? `${title} (EN)` : title;
        card.push({
          sign: '~',
          text: field === 'description' || !va ? `${label}: изменено` : `${label}: ${va} → ${vb}`,
        });
      }
    }
    if (JSON.stringify(a?.abilities ?? []) !== JSON.stringify(b?.abilities ?? [])) {
      card.push({
        sign: '~',
        text: lang === 'en' ? 'Что умеет (EN): изменено' : 'Что умеет: изменено',
      });
    }
  }
  if (prev && prev.price !== after.price) {
    card.push({ sign: '~', text: `Цена: ${rub(prev.price)} → ${rub(after.price)} в месяц` });
  }
  if (prev && prev.trialDays !== after.trialDays) {
    card.push({ sign: '~', text: `Пробный период: ${prev.trialDays} → ${after.trialDays} дн.` });
  }
  const plans = (c: TemplateContent | null) =>
    (c?.plans ?? []).map((p) => PLAN_TITLES[p] ?? p).join(', ') || '—';
  if (prev && plans(prev) !== plans(after)) {
    card.push({ sign: '~', text: `Тарифы: ${plans(prev)} → ${plans(after)}` });
  }
  if (prev && prev.defaultTrust !== after.defaultTrust) {
    card.push({
      sign: '~',
      text: `Самостоятельность при найме: ${TRUST_TITLES[prev.defaultTrust]} → ${TRUST_TITLES[after.defaultTrust]}`,
    });
  }
  if (prev && prev.model !== after.model) {
    card.push({
      sign: '~',
      text: `Модель: ${MODEL_TITLES[prev.model]} → ${MODEL_TITLES[after.model]}`,
    });
  }
  const offered = (c: TemplateContent | null) =>
    c?.onboarding.offered ? `да (${c.onboarding.goals.length} целей)` : 'нет';
  if (prev && offered(prev) !== offered(after)) {
    card.push({ sign: '~', text: `Предлагать в онбординге: ${offered(prev)} → ${offered(after)}` });
  }
  out.push(...section('card', card));

  // Prompt
  const prompt = lineDiff(prev?.prompt ?? '', after.prompt);
  out.push(
    ...section(
      'prompt',
      [
        ...prompt.added.slice(0, 12).map((text) => ({ sign: '+' as const, text })),
        ...prompt.removed.slice(0, 12).map((text) => ({ sign: '-' as const, text })),
      ],
      { added: prompt.added.length, removed: prompt.removed.length },
    ),
  );

  // Tools
  const tools: Array<{ sign: '+' | '-' | '~'; text: string }> = [];
  const title = (id: string) => TOOL_TITLES[id] ?? id;
  for (const tool of after.tools) {
    const old = prev?.tools.find((t) => t.id === tool.id);
    if (!old) {
      tools.push({ sign: '+', text: `${title(tool.id)} (${tool.id})` });
      continue;
    }
    for (const trust of TRUST_LEVELS) {
      if (old.modes[trust] !== tool.modes[trust]) {
        tools.push({
          sign: '~',
          text: `${title(tool.id)} · «${TRUST_TITLES[trust]}»: ${MODE_TITLES[old.modes[trust]]} → ${MODE_TITLES[tool.modes[trust]]}`,
        });
      }
    }
  }
  for (const tool of prev?.tools ?? []) {
    if (!after.tools.some((t) => t.id === tool.id)) {
      tools.push({ sign: '-', text: `${title(tool.id)} (${tool.id})` });
    }
  }
  out.push(...section('tools', tools));

  // Data
  const data: Array<{ sign: '+' | '-' | '~'; text: string }> = [];
  for (const group of after.requirements) {
    const old = prev?.requirements.find((r) => r.key === group.key);
    const name = group.texts.ru.title;
    if (!old) {
      data.push({ sign: '+', text: `${name}${group.required ? ' (обязательно)' : ''}` });
      continue;
    }
    if (old.required !== group.required) {
      data.push({
        sign: '~',
        text: `${name}: ${group.required ? 'теперь обязательно' : 'теперь по желанию'}`,
      });
    }
    if ([...old.providers].sort().join() !== [...group.providers].sort().join()) {
      data.push({
        sign: '~',
        text: `${name}: сервисы ${old.providers.join(', ') || '—'} → ${group.providers.join(', ') || '—'}`,
      });
    }
    if (old.texts.ru.purpose !== group.texts.ru.purpose || old.texts.ru.title !== group.texts.ru.title) {
      data.push({ sign: '~', text: `${name}: описание изменено` });
    }
  }
  for (const group of prev?.requirements ?? []) {
    if (!after.requirements.some((r) => r.key === group.key)) {
      data.push({ sign: '-', text: group.texts.ru.title });
    }
  }
  out.push(...section('data', data));

  // Limits
  const limits: Array<{ sign: '+' | '-' | '~'; text: string }> = [];
  for (const kind of Object.keys(LIMIT_KINDS)) {
    const a = (prev?.limits as Record<string, unknown> | undefined)?.[kind];
    const b = (after.limits as Record<string, unknown>)[kind];
    if ((a ?? null) !== (b ?? null)) {
      limits.push({
        sign: a === undefined ? '+' : b === undefined ? '-' : '~',
        text: `${LIMIT_TITLES[kind] ?? kind}: ${limitText(kind, a)} → ${limitText(kind, b)}`,
      });
    }
  }
  out.push(...section('limits', limits));

  // Asks
  const asks: Array<{ sign: '+' | '-' | '~'; text: string }> = [];
  for (const ask of after.asks.offered) {
    const was = prev?.asks.offered.includes(ask);
    const on = after.asks.defaults.includes(ask);
    if (!was) asks.push({ sign: '+', text: `${ASK_TITLES[ask] ?? ask}${on ? ' (включено)' : ''}` });
    else if (prev!.asks.defaults.includes(ask) !== on) {
      asks.push({
        sign: '~',
        text: `${ASK_TITLES[ask] ?? ask}: ${on ? 'включено' : 'выключено'} по умолчанию`,
      });
    }
  }
  for (const ask of prev?.asks.offered ?? []) {
    if (!after.asks.offered.includes(ask)) asks.push({ sign: '-', text: ASK_TITLES[ask] ?? ask });
  }
  out.push(...section('asks', asks));

  // Scenarios
  const scenarios: Array<{ sign: '+' | '-' | '~'; text: string }> = [];
  for (const s of after.scenarios) {
    const old = prev?.scenarios.find((o) => o.id === s.id);
    if (!old) scenarios.push({ sign: '+', text: s.title });
    else if (JSON.stringify(old) !== JSON.stringify(s))
      scenarios.push({ sign: '~', text: `${s.title}: изменён` });
  }
  for (const s of prev?.scenarios ?? []) {
    if (!after.scenarios.some((o) => o.id === s.id)) scenarios.push({ sign: '-', text: s.title });
  }
  out.push(...section('scenarios', scenarios));
  return out;
}

/** Up to three one-line summaries for the version list. */
export function diffSummary(sections: DiffSection[]): string[] {
  return sections.slice(0, 3).map((s) => {
    if (s.section === 'prompt') {
      return `${SECTION_TITLES.prompt}: +${s.added ?? 0} / −${s.removed ?? 0} строк`;
    }
    const first = s.lines[0]?.replace(/^[+−] /, '') ?? '';
    const more = s.lines.length > 1 ? ` и ещё ${s.lines.length - 1}` : '';
    return `${SECTION_TITLES[s.section]}: ${first}${more}`;
  });
}

export { SECTION_TITLES };
