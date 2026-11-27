import { z } from 'zod';

/**
 * Connections import: one text buffer, a skeleton for the model and coordinates back.
 * Values are resolved by the browser from its own fragments and never sent to the model.
 */

export const importFragmentParts = ['value', 'key', 'left', 'right'] as const;
export type ImportFragmentPart = (typeof importFragmentParts)[number];

export const importValueKinds = ['token', 'text', 'number', 'url', 'pem'] as const;
export type ImportValueKind = (typeof importValueKinds)[number];

/** A value candidate cut out of the buffer. Stays in the browser; `value` is never uploaded. */
export interface ImportFragment {
  id: string;
  /** 1-based line of the buffer. */
  line: number;
  part: ImportFragmentPart;
  key?: string;
  label?: string;
  value: string;
}

export interface ImportValueShape {
  length: number;
  kind: ImportValueKind;
  /** First four characters: the same ones a saved secret shows in its mask. */
  prefix?: string;
}

/** What leaves the browser: names, labels and the shape of a value, never the value. */
export interface ImportSkeletonFragment {
  id: string;
  line: number;
  part: ImportFragmentPart;
  key?: string;
  label?: string;
  shape: ImportValueShape;
  /** Deterministic registry match, added by the server. */
  providerHint?: string;
}

export interface ImportSkeleton {
  fragments: ImportSkeletonFragment[];
  note?: string;
}

export interface ImportAssignment {
  field: string;
  fragment: string;
}

export interface ImportItem {
  id: string;
  providerKey: string;
  fields: ImportAssignment[];
  confidence: 'high' | 'low';
  missing: string[];
}

export interface ImportQuestion {
  id: string;
  fragments: string[];
  text: string;
  options: string[];
  turn: number;
}

export interface ImportResult {
  items: ImportItem[];
  questions: ImportQuestion[];
  notes: string[];
  unmatched: string[];
}

export const importSkeletonSchema = z
  .object({
    fragments: z
      .array(
        z
          .object({
            id: z.string().min(1).max(24),
            line: z.number().int().min(1).max(10_000),
            part: z.enum(importFragmentParts).default('value'),
            key: z.string().max(120).optional(),
            label: z.string().max(120).optional(),
            shape: z
              .object({
                length: z.number().int().min(0).max(5000),
                kind: z.enum(importValueKinds),
                prefix: z.string().max(8).optional(),
              })
              .strict(),
          })
          .strict(),
      )
      .min(1)
      .max(120),
    note: z.string().max(500).optional(),
  })
  .strict();

export const importProposalSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            providerKey: z.string().min(1).max(40),
            fields: z
              .array(
                z.object({ field: z.string().min(1).max(40), fragment: z.string().min(1).max(24) }).strict(),
              )
              .min(1)
              .max(10),
            confidence: z.enum(['high', 'low']).default('low'),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    questions: z
      .array(
        z
          .object({
            fragments: z.array(z.string().min(1).max(24)).min(1).max(10),
            text: z.string().min(1).max(300),
            options: z.array(z.string().max(40)).max(10).default([]),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    notes: z.array(z.string().max(300)).max(10).default([]),
  })
  .strict();

export const importResultSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      providerKey: z.string(),
      fields: z.array(z.object({ field: z.string(), fragment: z.string() })),
      confidence: z.enum(['high', 'low']),
      missing: z.array(z.string()),
    }),
  ),
  questions: z.array(
    z.object({
      id: z.string(),
      fragments: z.array(z.string()),
      text: z.string(),
      options: z.array(z.string()),
      turn: z.number().int().min(1),
    }),
  ),
  notes: z.array(z.string()),
  unmatched: z.array(z.string()),
});

export const importJobSchema = z.object({
  status: z.enum(['queued', 'running', 'done', 'failed']),
  result: importResultSchema.nullable(),
  error: z.string().nullable(),
});

export type ImportProposal = z.infer<typeof importProposalSchema>;

export const IMPORT_LIMITS = { bytes: 64 * 1024, lines: 500, fragments: 120 } as const;

export function importValueShape(value: string): ImportValueShape {
  const kind: ImportValueKind = /^-----BEGIN [A-Z ]+-----/.test(value)
    ? 'pem'
    : /^https?:\/\//i.test(value)
      ? 'url'
      : /^\d+$/.test(value)
        ? 'number'
        : /^[A-Za-z0-9_\-./+=]+$/.test(value)
          ? 'token'
          : 'text';
  return {
    length: value.length,
    kind,
    prefix: value.length >= 8 ? value.slice(0, 4) : undefined,
  };
}

const DOTENV = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]{0,60})\s*=\s*(.*)$/;
// A name starts with a letter: `123456789:AAH…` is one value, not a name and a value.
const PAIR = /^\s*([A-Za-zА-Яа-яЁё_][^:=]{0,59}?)\s*[:—]\s*(\S.*)$/;
const TWO_VALUES = /^\s*(\S{2,})\s+(\S{2,})\s*$/;
const SINGLE_VALUE = /^\s*(\S{2,})\s*$/;
const PEM_BEGIN = /^\s*-----BEGIN [A-Z ]+-----/;
const PEM_END = /-----\s*$/;

function unquote(raw: string): string {
  const value = raw.trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
    return value.slice(1, -1);
  }
  return value;
}

/** Splits a line into at most one meaningful value; empty and comment-only lines give nothing. */
function fragmentsOfLine(line: string, lineNo: number, nextId: () => string): ImportFragment[] {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return [];

  const dotenv = DOTENV.exec(line);
  if (dotenv?.[2] && dotenv[2].trim()) {
    return [{ id: nextId(), line: lineNo, part: 'value', key: dotenv[1], value: unquote(dotenv[2]) }];
  }

  // `https://…` and `login@host:port` are values, not «key: value».
  if (!/^[a-z]+:\/\//i.test(trimmed)) {
    const pair = PAIR.exec(line);
    if (pair?.[2]) {
      const key = (pair[1] ?? '').trim();
      const value = unquote(pair[2]);
      if (value) {
        return [{ id: nextId(), line: lineNo, part: 'value', key, label: key, value }];
      }
    }
  }

  const two = TWO_VALUES.exec(line);
  if (two?.[1] && two[2] && !two[1].includes(',') && !two[2].includes(',')) {
    return [
      { id: nextId(), line: lineNo, part: 'left', value: two[1] },
      { id: nextId(), line: lineNo, part: 'right', value: two[2] },
    ];
  }

  const single = SINGLE_VALUE.exec(line);
  if (single?.[1]) return [{ id: nextId(), line: lineNo, part: 'value', value: unquote(single[1]) }];
  return [];
}

/**
 * Cuts the buffer into fragments: minimal values a provider field can be assigned to.
 * Pure and shared by the popup and the tests.
 */
export function buildFragments(text: string): ImportFragment[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const fragments: ImportFragment[] = [];
  let counter = 0;
  const nextId = () => `f${++counter}`;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (PEM_BEGIN.test(line)) {
      const block: string[] = [line.trim()];
      while (index + 1 < lines.length) {
        const next = lines[index + 1] ?? '';
        block.push(next);
        index += 1;
        if (PEM_END.test(next)) break;
      }
      fragments.push({
        id: nextId(),
        line: index + 1 - block.length + 1,
        part: 'value',
        key: 'pem',
        value: block.join('\n'),
      });
      continue;
    }
    fragments.push(...fragmentsOfLine(line, index + 1, nextId));
    if (fragments.length >= IMPORT_LIMITS.fragments) break;
  }
  return fragments.slice(0, IMPORT_LIMITS.fragments);
}

/** The skeleton that goes to the model: no values, only ids, names and shapes. */
export function importSkeleton(fragments: ImportFragment[], note?: string): ImportSkeleton {
  return {
    fragments: fragments.map((fragment) => ({
      id: fragment.id,
      line: fragment.line,
      part: fragment.part,
      key: fragment.key,
      label: fragment.label,
      shape: importValueShape(fragment.value),
    })),
    note: note?.trim() ? note.trim().slice(0, 500) : undefined,
  };
}

export interface ImportMatchProvider {
  key: string;
  envPrefix?: string;
  aliases?: readonly string[];
  fields: ReadonlyArray<{ key: string; envKeys?: readonly string[]; aliases?: readonly string[] }>;
}

const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Deterministic pre-pass: guesses a provider from the key, label and env prefix.
 * A hint, not a decision — the model may disagree and the person always sees the result.
 */
export function matchFragments(
  fragments: ReadonlyArray<Pick<ImportSkeletonFragment, 'id' | 'key' | 'label' | 'shape'>>,
  providers: readonly ImportMatchProvider[],
): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const fragment of fragments) {
    const words = [fragment.key, fragment.label].filter((word): word is string => Boolean(word));
    if (!words.length) continue;
    const candidates = words.map((word) => normalize(word));
    const found = providers.find((provider) => {
      const prefix = provider.envPrefix ? normalize(provider.envPrefix) : null;
      const aliases = (provider.aliases ?? []).map(normalize);
      return candidates.some(
        (candidate) =>
          (prefix !== null && prefix.length > 1 && candidate.startsWith(prefix)) ||
          aliases.some((alias) => alias.length > 1 && candidate.includes(alias)) ||
          provider.fields.some((field) =>
            [...(field.envKeys ?? []), ...(field.aliases ?? [])].some((alias) => {
              const normalized = normalize(alias);
              return normalized.length > 1 && candidate === normalized;
            }),
          ),
      );
    });
    if (found) hints[fragment.id] = found.key;
  }
  return hints;
}

export const importSkeletonRequestSchema = z.object({ skeleton: importSkeletonSchema }).strict();
export const importJobResponseSchema = z.object({ jobId: z.uuid() });

export const importGroupResultSchema = z.object({
  providerKey: z.string(),
  outcome: z.enum(['created', 'replaced', 'skipped', 'unchanged', 'failed']),
  connectionId: z.string().nullable(),
  status: z.string().nullable(),
  masked: z.string().nullable(),
  error: z.object({ code: z.string(), field: z.string().optional() }).nullable(),
});

export const importResponseSchema = z.object({ items: z.array(importGroupResultSchema) });
export type ImportResponse = z.infer<typeof importResponseSchema>;

export const importFileLimits = {
  /** Text files only: a pasted table, an .env or a note. */
  extensions: ['.txt', '.env', '.md'],
  maxBytes: IMPORT_LIMITS.bytes,
} as const;
