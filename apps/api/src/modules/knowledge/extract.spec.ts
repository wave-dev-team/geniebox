import ExcelJS from 'exceljs';

import { chunkPage, estimateTokens } from './chunker.js';
import {
  detectFormat,
  extractCsv,
  extractDocument,
  extractMarkdown,
  UnsupportedSourceError,
} from './extract.js';

describe('knowledge extraction', () => {
  it('rejects an unknown extension and a renamed binary file', () => {
    expect(() => detectFormat('report.pdf', Buffer.from('hello'))).toThrow(UnsupportedSourceError);
    expect(() => detectFormat('data.csv', Buffer.from([0x00, 0x01, 0x02]))).toThrow(UnsupportedSourceError);
    expect(() => detectFormat('data.xlsx', Buffer.from('PK is not enough here'))).toThrow(
      UnsupportedSourceError,
    );
  });

  it('keeps the heading breadcrumbs of a markdown document', () => {
    const document = extractMarkdown(
      'conversion.md',
      '# Конверсия\n\nДоля заказов.\n\n## Сезонность\n\nОктябрь провальный.\n',
    );
    expect(document.title).toBe('Конверсия');
    expect(document.parts.map((part) => part.headingPath)).toEqual([
      ['Конверсия'],
      ['Конверсия', 'Сезонность'],
    ]);
    expect(document.parts[1]!.text).toContain('Октябрь');
  });

  it('renders a csv as tables with the header repeated', () => {
    const document = extractCsv('sales.csv', 'Показатель;Значение\nВыручка;10\nКонверсия;2,5\n');
    expect(document.parts).toHaveLength(1);
    expect(document.parts[0]!.text).toContain('| Показатель | Значение |');
    expect(document.parts[0]!.text).toContain('| Конверсия | 2,5 |');
    expect(document.parts[0]!.locator).toEqual({ rowStart: 2, rowEnd: 3 });
  });

  it('reads every sheet of a workbook into its own part', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Метрики');
    sheet.addRow(['Показатель', 'Значение']);
    sheet.addRow(['Выручка', 1000]);
    const second = workbook.addWorksheet('Пустой');
    second.addRow(['Заголовок']);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());

    const document = await extractDocument('xlsx', 'dataset.xlsx', bytes);
    expect(document.parts).toHaveLength(1);
    expect(document.parts[0]!.headingPath).toEqual(['dataset', 'Метрики']);
    expect(document.parts[0]!.text).toContain('| Выручка | 1000 |');
    expect(document.parts[0]!.locator).toEqual({ sheet: 'Метрики', rowStart: 2, rowEnd: 2 });
  });
});

describe('knowledge chunking', () => {
  it('splits by headings and never loses the page title', () => {
    const chunks = chunkPage('Конверсия', 'Вводный абзац.\n\n## Сезонность\n\nОктябрь падает.');
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.headingPath).toEqual(['Конверсия']);
    expect(chunks[1]!.headingPath).toEqual(['Конверсия', 'Сезонность']);
  });

  it('keeps chunks under the cap and carries an overlap', () => {
    const paragraph = 'Фраза про магазин и его покупателей. '.repeat(120);
    const body = Array.from({ length: 6 }, () => paragraph).join('\n\n');
    const chunks = chunkPage('Документ', body);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(700);
    const tail = chunks[0]!.text.slice(-100);
    expect(chunks[1]!.text).toContain(tail);
  });

  it('estimates Cyrillic as more expensive than Latin', () => {
    expect(estimateTokens('привет мир')).toBeGreaterThan(estimateTokens('hello world'));
  });
});
