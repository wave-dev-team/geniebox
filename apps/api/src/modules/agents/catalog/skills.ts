export interface SkillPlaybook {
  key: string;
  title: string;
  prompt: string;
  recommendedTools: readonly string[];
  recommendedProviders: readonly string[];
  approvalHint?: string;
}

export const SKILL_PLAYBOOKS: readonly SkillPlaybook[] = [
  {
    key: 'surveys',
    title: 'Исследования и опросы',
    prompt:
      'Compare signals from user research/interviews (knowledge.search, or knowledge.tree + knowledge.read if search returns empty, with source citations) against quantitative metrics before proposing changes.',
    recommendedTools: ['knowledge.search', 'knowledge.sources', 'metrics_read'],
    recommendedProviders: [],
  },
  {
    key: 'promo',
    title: 'Промо и акции',
    prompt:
      'Check promo budget limits and historical conversion impact before proposing discounts or promo campaigns.',
    recommendedTools: ['metrics_read', 'api.read', 'propose_decision'],
    recommendedProviders: ['http_api'],
    approvalHint: 'Use propose_decision for any promo launch or spend.',
  },
  {
    key: 'ab',
    title: 'A/B-эксперименты и гипотезы',
    prompt:
      'Formulate hypotheses with explicit success criteria, control group share, minimum sample size, guardrail metrics and post-release check (experiment + check in propose_decision).',
    recommendedTools: ['metrics_read', 'propose_decision', 'record_check'],
    recommendedProviders: [],
  },
  {
    key: 'digest',
    title: 'Дайджест и уведомления',
    prompt:
      'Publish key anomalies with publish_insight and notify the owner via notify.owner BEFORE calling finish_task or propose_decision (which end your turn).',
    recommendedTools: ['metrics_read', 'publish_insight', 'notify.owner'],
    recommendedProviders: [],
  },
  {
    key: 'metrika_analysis',
    title: 'Анализ Яндекс.Метрики через API',
    prompt:
      'Use api.read on /stat/v1/data (passing metrics, dimensions such as ym:s:date or ym:s:pagePath, date1, date2) to inspect traffic, bounce rate, page-level conversions and post-release dynamics.',
    recommendedTools: ['api.read', 'metrics_read', 'publish_insight'],
    recommendedProviders: ['yandex_metrika', 'http_api'],
  },
  {
    key: 'backlog_sync',
    title: 'Сверка и постановка задач в бэклог',
    prompt:
      'Before proposing a new backlog item, read existing issues via api.read (/issues), check if an existing task (e.g. T-08) already covers the problem, and include actions: [{ toolId: "api.call", args: { method: "POST", path: "/issues", body: { title, description, priority, tags: ["сгенерирована ИИ-помощником"] } } }] (or PATCH /issues/<id>) inside propose_decision.',
    recommendedTools: ['api.read', 'api.call', 'propose_decision'],
    recommendedProviders: ['http_api'],
    approvalHint: 'Always wrap backlog mutations (api.call) in propose_decision.',
  },
];

const BY_KEY = new Map(SKILL_PLAYBOOKS.map((s) => [s.key, s]));

export function findSkillPlaybook(key: string): SkillPlaybook | undefined {
  return BY_KEY.get(key);
}

/** Resolves active playbooks from explicit `skill:<key>` instructions or default template skills. */
export function resolveSkillPlaybooks(
  instructions: ReadonlyArray<{ topic: string; rule: string }>,
  template: string | null,
): SkillPlaybook[] {
  const keys = new Set<string>();
  for (const item of instructions) {
    if (item.topic.startsWith('skill:')) {
      keys.add(item.topic.slice('skill:'.length));
    }
  }
  if (template === 'analyst') {
    keys.add('metrika_analysis');
    keys.add('ab');
    keys.add('surveys');
  } else if (template === 'marketer') {
    keys.add('ab');
    keys.add('promo');
  }
  return [...keys].map((k) => BY_KEY.get(k)).filter((s): s is SkillPlaybook => Boolean(s));
}
