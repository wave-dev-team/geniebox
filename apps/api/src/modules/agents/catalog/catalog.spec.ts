import { AGENT_TEMPLATES_V1 } from '../../../database/migrations/data/agent-templates-v1.js';
import { templateContentSchema } from '../../catalog/catalog-content.js';
import { presetMode, toolsForProviders } from './catalog.js';

describe('agent catalog', () => {
  it('derives the default mode from trust level and risk', () => {
    expect(presetMode('approve_all', 'low')).toBe('notify');
    expect(presetMode('approve_all', 'high')).toBe('approve');
    expect(presetMode('approve_important', 'low')).toBe('auto');
    expect(presetMode('approve_important', 'medium')).toBe('notify');
    expect(presetMode('autonomous', 'medium')).toBe('auto');
    expect(presetMode('autonomous', 'high')).toBe('notify');
  });

  it('seeds valid v1 content for every former code template', () => {
    for (const template of AGENT_TEMPLATES_V1) {
      const parsed = templateContentSchema.safeParse(template.content);
      expect(parsed.error?.issues ?? []).toEqual([]);
    }
    expect(new Set(AGENT_TEMPLATES_V1.map((t) => t.key)).size).toBe(15);
  });

  it('keeps the onboarding agents in the seed', () => {
    const keys = AGENT_TEMPLATES_V1.map((t) => t.key);
    for (const key of ['support', 'analyst', 'marketer', 'engineer', 'content']) {
      expect(keys).toContain(key);
    }
  });

  it('gives a custom agent the tools of its connections', () => {
    const tools = toolsForProviders(['gitlab']);
    expect(tools).toEqual(expect.arrayContaining(['code.read', 'code.mr.create', 'policy.update']));
    expect(tools).not.toContain('bot.reply');
  });
});
