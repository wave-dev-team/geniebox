/**
 * Structural chunking of a page for the search index. Parts follow Markdown headings; long
 * sections are cut by paragraphs with a small overlap so an answer spanning a boundary is
 * still found. Chunks are sized for the context budget, never for the whole page.
 */

export interface ChunkDraft {
  headingPath: string[];
  text: string;
  tokenCount: number;
}

const MAX_TOKENS = 700;
const OVERLAP_CHARS = 240;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** Rough but stable: Cyrillic costs more tokens per character than Latin. */
export function estimateTokens(text: string): number {
  const cyrillic = (text.match(/[\u0400-\u04FF]/g) ?? []).length;
  return Math.ceil((text.length - cyrillic) / 4 + cyrillic / 2.5);
}

interface Section {
  headingPath: string[];
  lines: string[];
}

export function chunkPage(title: string, body: string): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  for (const section of splitSections(title, body)) {
    chunks.push(...chunkSection(section));
  }
  return chunks;
}

function splitSections(title: string, body: string): Section[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const sections: Section[] = [];
  const stack: string[] = [];
  let current: Section = { headingPath: [title], lines: [] };

  const flush = () => {
    if (current.lines.some((line) => line.trim())) sections.push(current);
  };

  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      stack.length = Math.min(stack.length, level - 1);
      stack[level - 1] = heading[2]!;
      current = { headingPath: [title, ...stack.filter(Boolean)], lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  flush();
  return sections;
}

function chunkSection(section: Section): ChunkDraft[] {
  const paragraphs = section.lines
    .join('\n')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks: ChunkDraft[] = [];
  let buffer = '';

  const emit = (): string => {
    const text = buffer.trim();
    buffer = '';
    if (!text) return '';
    chunks.push({ headingPath: section.headingPath, text, tokenCount: estimateTokens(text) });
    return text.slice(-OVERLAP_CHARS);
  };

  for (const paragraph of paragraphs) {
    for (const piece of splitBySize(paragraph)) {
      const candidate = buffer ? `${buffer}\n\n${piece}` : piece;
      if (estimateTokens(candidate) <= MAX_TOKENS) {
        buffer = candidate;
        continue;
      }
      const tail = emit();
      buffer = tail && estimateTokens(`${tail}\n\n${piece}`) <= MAX_TOKENS ? `${tail}\n\n${piece}` : piece;
    }
  }
  emit();
  return chunks;
}

function splitBySize(paragraph: string): string[] {
  if (estimateTokens(paragraph) <= MAX_TOKENS) return [paragraph];
  // Hard split of one oversized paragraph. Two characters per token is the safe bound for
  // Cyrillic, so the resulting part stays under the cap for any script.
  const size = Math.max(200, Math.floor(MAX_TOKENS * 2));
  const parts: string[] = [];
  for (let index = 0; index < paragraph.length; index += size) {
    const part = paragraph.slice(index, index + size).trim();
    if (part) parts.push(part);
  }
  return parts;
}
