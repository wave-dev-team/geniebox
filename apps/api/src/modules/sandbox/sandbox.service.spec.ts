import { DemoSandboxService } from './sandbox.service.js';

describe('DemoSandboxService', () => {
  it('returns metrika totals and page dimensions', () => {
    const svc = new DemoSandboxService();
    const res = svc.metrikaData({
      metrics: 'ym:s:visits,ym:s:bounceRate',
      dimensions: 'ym:s:pagePath',
    });
    expect(res.totals).toHaveLength(2);
    expect(res.data).toHaveLength(3);
    expect(res.data[0]?.dimensions[0]?.name).toBe('/catalog/kaspersky');
  });

  it('creates and updates backlog issues with default AI tag', () => {
    const svc = new DemoSandboxService();
    const created = svc.createIssue({ title: 'Исправить воронку чекаута', priority: 'high' });
    expect(created.tags).toContain('сгенерирована ИИ-помощником');
    const updated = svc.updateIssue('T-08', { status: 'in_progress' });
    expect(updated?.status).toBe('in_progress');
  });
});
