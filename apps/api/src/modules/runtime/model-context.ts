import type { ModelMessage } from './model-provider.js';

export function buildMessages(
  current: string,
  previous: { message: string; answer: string | null }[],
  name: string | undefined,
  system: string,
  contextLimit = 10_000,
): ModelMessage[] {
  const redact = createRedactor(name);

  const message = redact(current);
  const history: ModelMessage[] = [];
  let length = system.length + message.length;
  for (const turn of previous) {
    if (!turn.answer) continue;
    const user = redact(turn.message);
    const assistant = redact(turn.answer);
    length += user.length + assistant.length;
    if (length > contextLimit) break;
    history.unshift({ role: 'user', content: user }, { role: 'assistant', content: assistant });
  }

  return [{ role: 'system', content: system }, ...history, { role: 'user', content: message }];
}

export function createRedactor(name?: string) {
  const profileName = name?.trim();
  const namePattern = profileName
    ? new RegExp(
        `(?<![\\p{L}\\p{N}])${profileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
        'giu',
      )
    : undefined;

  return (text: string) => {
    const masked = text
      .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, '[email]')
      .replace(/(?<![\p{L}\p{N}])\+?\d(?:[ ().-]*\d){9,18}(?![\p{L}\p{N}])/gu, '[number]');
    return namePattern ? masked.replace(namePattern, '[name]') : masked;
  };
}
