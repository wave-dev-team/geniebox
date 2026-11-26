/**
 * What the broker enforces: tools with their risk class, «always ask»
 * switches and limit kinds. Code, not tables: it versions with the broker. The templates that
 * combine them live in the database (modules/catalog).
 */

export const RISK_CLASSES = ['low', 'medium', 'high'] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

export const PERMISSION_MODES = ['auto', 'notify', 'approve', 'deny'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export interface ToolDefinition {
  /** Stable broker action id. */
  id: string;
  risk: RiskClass;
  /** Forbidden by the system for every agent; cannot be changed in UI or API. */
  systemDenied?: boolean;
  /** Provider whose connection the tool acts through, if any. */
  providers?: readonly string[];
}

export const TOOLS: readonly ToolDefinition[] = [
  { id: 'bot.reply', risk: 'low', providers: ['telegram_bot'] },
  { id: 'bot.broadcast', risk: 'high', providers: ['telegram_bot'] },
  { id: 'bot.texts.update', risk: 'medium', providers: ['telegram_bot'] },
  { id: 'content.post', risk: 'medium', providers: ['telegram_bot'] },
  { id: 'promo.create', risk: 'medium' },
  { id: 'payments.read', risk: 'low', providers: ['yookassa'] },
  { id: 'payments.refund', risk: 'high', providers: ['yookassa'] },
  { id: 'analytics.read', risk: 'low', providers: ['yandex_metrika'] },
  { id: 'db.query', risk: 'low', providers: ['postgres'] },
  { id: 'api.read', risk: 'low', providers: ['http_api'] },
  { id: 'api.call', risk: 'medium', providers: ['http_api'] },
  { id: 'monitoring.read', risk: 'low', providers: ['grafana'] },
  { id: 'server.runbook', risk: 'medium', providers: ['ssh_server'] },
  { id: 'server.restart', risk: 'high', providers: ['ssh_server'] },
  { id: 'code.read', risk: 'low', providers: ['gitlab'] },
  { id: 'code.mr.create', risk: 'medium', providers: ['gitlab'] },
  { id: 'code.mr.merge', risk: 'high', providers: ['gitlab'] },
  { id: 'web.search', risk: 'low' },
  // Closed in the system, shown with a lock («Никогда не сможет»).
  { id: 'prices.update', risk: 'high', systemDenied: true },
  { id: 'customers.delete', risk: 'high', systemDenied: true },
  { id: 'policy.update', risk: 'high', systemDenied: true },
  { id: 'ads.publish', risk: 'high', systemDenied: true },
];

/**
 * «Всегда спрашивать меня, прежде чем…» switches of an agent. The first five equal the project
 * rules: a project rule is always on for every agent — stricter per agent, never looser.
 */
export const ASKS = [
  'discount_over_20',
  'mailing_over_500',
  'spend_over_10000',
  'release_changes',
  'publish_on_behalf',
  'bot_texts_change',
  'public_reviews_reply',
  'refund_any',
  'server_restart',
] as const;
export type AskKey = (typeof ASKS)[number];

export const LIMIT_KINDS = {
  ai_budget_monthly: { unit: 'rub', max: 10_000_000 },
  promo_budget_monthly: { unit: 'rub', max: 10_000_000 },
  promo_codes_per_day: { unit: 'count', max: 100_000 },
  recipients_per_send: { unit: 'count', max: 1_000_000 },
  releases_per_week: { unit: 'count', max: 1_000 },
  quiet_hours: { unit: 'time_range', max: 0 },
} as const;
export type LimitKind = keyof typeof LIMIT_KINDS;
export type LimitValue = number | string;

/** Built-in skills: free and on for every project. */
export const SKILLS = ['surveys', 'promo', 'ab', 'digest'] as const;

const TOOL_BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]));

export function findTool(id: string): ToolDefinition | undefined {
  return TOOL_BY_ID.get(id);
}

/** Tools of a custom agent: what its connections allow, plus the system-closed ones. */
export function toolsForProviders(providerKeys: readonly string[]): string[] {
  const allowed = TOOLS.filter(
    (tool) => tool.systemDenied || tool.providers?.some((p) => providerKeys.includes(p)),
  );
  return allowed.filter((tool) => tool.id !== 'ads.publish').map((tool) => tool.id);
}

/**
 * Default mode from the agent's trust level and the tool's risk class. An explicit
 * permission overrides it; a system-denied tool is always «deny».
 */
export function presetMode(trust: string, risk: RiskClass): PermissionMode {
  switch (trust) {
    case 'autonomous':
      return risk === 'high' ? 'notify' : 'auto';
    case 'approve_important':
      return risk === 'low' ? 'auto' : risk === 'medium' ? 'notify' : 'approve';
    default:
      return risk === 'low' ? 'notify' : 'approve';
  }
}
