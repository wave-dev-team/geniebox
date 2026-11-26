/**
 * Human names of catalog templates for texts the backend writes itself (buttons,
 * the journal). The names live in the catalog; CatalogService fills this map
 * on every refresh, so these helpers stay plain functions.
 */
let TITLES = new Map<string, { ru: string; en: string }>();

export function setTemplateTitles(titles: Map<string, { ru: string; en: string }>): void {
  TITLES = titles;
}

export function templateTitle(key: string, lang = 'ru'): string {
  const title = TITLES.get(key);
  if (!title) return key;
  return lang === 'en' ? title.en : title.ru;
}

/** What people call an agent: its own name, or the template's when it was never renamed. */
export function agentTitle(
  agent: { kind: string; template_key: string | null; display_name: string },
  lang = 'ru',
): string {
  if (agent.kind === 'manager') return lang === 'en' ? 'Manager' : 'Управляющий';
  if (agent.template_key && agent.display_name === agent.template_key) {
    return templateTitle(agent.template_key, lang);
  }
  return agent.display_name;
}
