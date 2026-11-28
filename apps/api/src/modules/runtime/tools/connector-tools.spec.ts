import { resolveSkillPlaybooks } from '../../agents/catalog/skills.js';
import { assertReadOnlySql } from './connector-tools.js';

describe('assertReadOnlySql', () => {
  it('accepts SELECT and WITH queries', () => {
    expect(assertReadOnlySql('  SELECT id, name FROM products LIMIT 10; ')).toBe(
      'SELECT id, name FROM products LIMIT 10',
    );
    expect(assertReadOnlySql('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(
      'WITH cte AS (SELECT 1) SELECT * FROM cte',
    );
  });

  it('rejects mutating statements and multi-statement SQL', () => {
    expect(() => assertReadOnlySql('DELETE FROM orders')).toThrow('READ_ONLY_SQL');
    expect(() => assertReadOnlySql('SELECT 1; DROP TABLE users')).toThrow('READ_ONLY_SQL');
    expect(() => assertReadOnlySql('WITH x AS (UPDATE orders SET status = 1) SELECT * FROM x')).toThrow(
      'READ_ONLY_SQL',
    );
  });
});

describe('resolveSkillPlaybooks', () => {
  it('resolves template defaults and explicit skill instructions', () => {
    const analyst = resolveSkillPlaybooks([], 'analyst').map((s) => s.key);
    expect(analyst).toContain('metrika_analysis');
    expect(analyst).toContain('ab');

    const custom = resolveSkillPlaybooks([{ topic: 'skill:backlog_sync', rule: 'custom' }], null).map(
      (s) => s.key,
    );
    expect(custom).toEqual(['backlog_sync']);
  });
});
