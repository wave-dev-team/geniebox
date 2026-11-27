import { extname } from 'node:path';

import ExcelJS from 'exceljs';

import {
  KNOWLEDGE_FILE_FORMATS,
  KNOWLEDGE_FORMAT_MIME,
  KNOWLEDGE_LIMITS,
  type KnowledgeFileFormat,
} from './knowledge.constants.js';

/** One place of the source: a heading range or a spreadsheet block, kept on every citation. */
export interface ExtractedPart {
  /** Heading breadcrumbs; the page title uses the last item. */
  headingPath: string[];
  /** Markdown of this part. */
  text: string;
  /** Where it came from: `{section, charStart, charEnd}` or `{sheet, rowStart, rowEnd}`. */
  locator: Record<string, string | number | null>;
}

export interface ExtractedDocument {
  /** Suggested title of the source page: the document heading or file name. */
  title: string;
  parts: ExtractedPart[];
}

export class UnsupportedSourceError extends Error {}

/** True when the bytes really are the format the extension promises. */
export function detectFormat(filename: string, data: Buffer): KnowledgeFileFormat {
  const ext = extname(filename).slice(1).toLowerCase();
  const format = KNOWLEDGE_FILE_FORMATS.find((value) => value === ext);
  if (!format) throw new UnsupportedSourceError(`unsupported extension: .${ext || 'none'}`);
  if (format === 'xlsx') {
    // XLSX is a zip; the local file header marks the real archive, not a renamed text file.
    const zipHeader = data.subarray(0, 4).toString('latin1');
    if (zipHeader !== 'PK\u0003\u0004') {
      throw new UnsupportedSourceError('the file is not an xlsx workbook');
    }
  } else if (data.includes(0)) {
    throw new UnsupportedSourceError('the file looks binary, not text');
  }
  return format;
}

export function mimeFor(format: KnowledgeFileFormat): string {
  return KNOWLEDGE_FORMAT_MIME[format][0]!;
}

export async function extractDocument(
  format: KnowledgeFileFormat,
  filename: string,
  data: Buffer,
): Promise<ExtractedDocument> {
  switch (format) {
    case 'md':
      return extractMarkdown(filename, data.toString('utf8'));
    case 'txt':
      return extractPlainText(filename, data.toString('utf8'));
    case 'csv':
      return extractCsv(filename, data.toString('utf8'));
    case 'xlsx':
      return extractXlsx(filename, data);
    default:
      throw new UnsupportedSourceError(`unsupported format: ${String(format)}`);
  }
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** Markdown: headings become breadcrumbs, each heading section becomes one part. */
export function extractMarkdown(filename: string, text: string): ExtractedDocument {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const parts: ExtractedPart[] = [];
  const stack: string[] = [];
  let buffer: string[] = [];
  let headingPath: string[] = [];
  let offset = 0;
  let start = 0;

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body) {
      parts.push({
        headingPath: headingPath.length ? headingPath : [stripExtension(filename)],
        text: body,
        locator: { charStart: start, charEnd: start + body.length },
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      stack.length = Math.min(stack.length, level - 1);
      stack[level - 1] = heading[2]!;
      headingPath = stack.filter(Boolean).slice(0, level);
      start = offset + line.length + 1;
    } else {
      buffer.push(line);
    }
    offset += line.length + 1;
  }
  flush();

  const title = firstHeading(lines) ?? stripExtension(filename);
  return { title, parts: parts.length ? parts : [{ headingPath: [title], text: text.trim(), locator: {} }] };
}

/** Plain text: paragraphs, split only when a part would be too long for one chunk. */
export function extractPlainText(filename: string, text: string): ExtractedDocument {
  const title = stripExtension(filename);
  const blocks = splitLong(text.replace(/\r\n/g, '\n').trim(), KNOWLEDGE_LIMITS.sectionChars);
  return {
    title,
    parts: blocks.map((block, index) => ({
      headingPath: [title],
      text: block,
      locator:
        index === 0 ? { charStart: 0, charEnd: block.length } : ({ block: index } as Record<string, number>),
    })),
  };
}

/** CSV: the header row is repeated in every table block so a chunk stays readable alone. */
export function extractCsv(filename: string, text: string): ExtractedDocument {
  const rows = parseCsv(text);
  const title = stripExtension(filename);
  if (rows.length === 0) return { title, parts: [] };
  const header = rows[0]!;
  const body = rows.slice(1);
  const parts: ExtractedPart[] = [];
  for (let index = 0; index < body.length; index += KNOWLEDGE_LIMITS.sheetRows) {
    const slice = body.slice(index, index + KNOWLEDGE_LIMITS.sheetRows);
    parts.push({
      headingPath: [title],
      text: toMarkdownTable(header, slice),
      locator: { rowStart: index + 2, rowEnd: index + 1 + slice.length },
    });
  }
  return { title, parts };
}

/** XLSX: one part per sheet block; the sheet name becomes the heading. */
export async function extractXlsx(filename: string, data: Buffer): Promise<ExtractedDocument> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as unknown as ArrayBuffer);
  const title = stripExtension(filename);
  const parts: ExtractedPart[] = [];
  workbook.eachSheet((sheet) => {
    const grid: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values: string[] = [];
      for (let column = 1; column <= KNOWLEDGE_LIMITS.sheetColumns; column += 1) {
        values.push(cellText(row.getCell(column).value));
      }
      if (values.some((value) => value !== '')) grid.push(values);
    });
    if (grid.length < 2) return;
    const header = grid[0]!;
    const body = grid.slice(1);
    for (let index = 0; index < body.length; index += KNOWLEDGE_LIMITS.sheetRows) {
      const slice = body.slice(index, index + KNOWLEDGE_LIMITS.sheetRows);
      parts.push({
        headingPath: [title, sheet.name],
        text: toMarkdownTable(header, slice),
        locator: {
          sheet: sheet.name,
          rowStart: index + 2,
          rowEnd: index + 1 + slice.length,
        },
      });
    }
  });
  return { title, parts };
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    if ('error' in value) return '';
  }
  return String(value).replace(/\s+/g, ' ').trim();
}

/** Markdown table with escaped pipes: readable for a model and for a person in the editor. */
function toMarkdownTable(header: string[], rows: string[][]): string {
  const escape = (value: string) => value.replace(/\|/g, '\\|');
  const width = header.length;
  const lines = [
    `| ${header.map((value, index) => escape(value || `Колонка ${index + 1}`)).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];
  for (const row of rows) {
    const cells = Array.from({ length: width }, (_, index) => escape(row[index] ?? ''));
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

/** Minimal RFC 4180 reader: quoted cells, escaped quotes, `;` and `,` delimiters. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const delimiter = detectDelimiter(text);
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n') {
      row.push(cell.trim());
      cell = '';
      rows.push(row);
      row = [];
    } else if (char !== '\r') {
      cell += char;
    }
  }
  row.push(cell.trim());
  rows.push(row);
  return rows.filter((values) => values.some((value) => value !== ''));
}

function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

function splitLong(text: string, limit: number): string[] {
  if (text.length <= limit) return text ? [text] : [];
  const blocks: string[] = [];
  let current = '';
  for (const paragraph of text.split(/\n{2,}/)) {
    if (current.length + paragraph.length + 2 > limit && current) {
      blocks.push(current.trim());
      current = '';
    }
    current += `${paragraph}\n\n`;
  }
  if (current.trim()) blocks.push(current.trim());
  return blocks;
}

function firstHeading(lines: string[]): string | undefined {
  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading?.[1]!.length === 1) return heading[2];
  }
  return undefined;
}

function stripExtension(filename: string): string {
  const name = filename.split(/[\\/]/).pop() ?? filename;
  return name.replace(/\.[A-Za-z0-9]{1,8}$/, '').slice(0, KNOWLEDGE_LIMITS.sourceTitle) || 'Источник';
}
