import { CONNECTION_ERRORS, ConnectionException } from '../connections.errors.js';
import type { ProviderDefinition, ProviderField } from './provider.types.js';

const HOST =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$|^\[?[0-9a-f:.]+\]?$/i;

function invalid(field: string): never {
  throw new ConnectionException(CONNECTION_ERRORS.CONNECTION_FIELDS_INVALID, {
    messageArgs: { field },
  });
}

function validateField(field: ProviderField, raw: string): string {
  const value = field.kind === 'secret' ? raw : raw.trim();
  if (value.length > (field.maxLength ?? 500)) invalid(field.key);
  if (field.pattern && !field.pattern.test(value)) invalid(field.key);
  switch (field.kind) {
    case 'url': {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        invalid(field.key);
      }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
        invalid(field.key);
      }
      return value;
    }
    case 'host':
      return HOST.test(value) ? value.toLowerCase() : invalid(field.key);
    case 'port': {
      const port = Number(value);
      return Number.isInteger(port) && port > 0 && port < 65536 ? String(port) : invalid(field.key);
    }
    case 'select':
      return field.options?.includes(value) ? value : invalid(field.key);
    default:
      return value;
  }
}

/**
 * Splits user input into plain config and the secret part, validating every field of the
 * provider. Unknown keys are rejected. With `secretsOnly` (rotation) only secret fields count.
 */
export function splitFields(
  provider: ProviderDefinition,
  input: Record<string, unknown>,
  options: { secretsOnly?: boolean } = {},
): { config: Record<string, string>; secret: Record<string, string> } {
  const fields = provider.fields.filter((f) => !options.secretsOnly || f.kind === 'secret');
  const known = new Set(fields.map((field) => field.key));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) invalid(key);
  }
  const config: Record<string, string> = {};
  const secret: Record<string, string> = {};
  for (const field of fields) {
    const raw = input[field.key];
    if (raw !== undefined && typeof raw !== 'string') invalid(field.key);
    const given = typeof raw === 'string' && raw.trim() !== '' ? raw : undefined;
    if (given === undefined) {
      if (field.required) invalid(field.key);
      if (field.defaultValue !== undefined) config[field.key] = field.defaultValue;
      continue;
    }
    const value = validateField(field, given);
    if (field.kind === 'secret') secret[field.key] = value;
    else config[field.key] = value;
  }
  return { config, secret };
}

/** ••••a91f; short secrets show nothing but the dots. */
export function mask(value: string): string {
  return value.length >= 12 ? `••••${value.slice(-4)}` : '••••';
}
