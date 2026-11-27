import { jest } from '@jest/globals';

import type { AccountDb, AccountTx } from '../../database/scoped-db.js';
import type { JournalService } from '../../journal/journal.service.js';
import type { OutboxService } from '../../outbox/outbox.service.js';
import type { ProjectContext } from '../projects/project-context.js';
import type { StreamPublisher } from '../stream/stream.publisher.js';
import type { DecisionsRepository } from './repositories/decisions.repository.js';
import type { TaskRow, TasksRepository } from './repositories/tasks.repository.js';
import { TasksService } from './tasks.service.js';
import { WorkException } from './work.errors.js';

function makeTaskRow(overrides: Partial<TaskRow> & { id: string }): TaskRow {
  const now = new Date('2026-11-28T00:00:00Z');
  return {
    account_id: 'acc-1',
    project_id: 'proj-1',
    agent_id: 'agent-1',
    routine_id: null,
    parent_task_id: null,
    assigned_by_agent_id: null,
    title: `Task ${overrides.id}`,
    description: null,
    origin: 'owner',
    mode: null,
    status: 'planned',
    waiting_reason: null,
    progress_pct: null,
    progress_text: null,
    conversation_id: null,
    summary: null,
    result: null,
    facts: [],
    error: null,
    attempts: 0,
    scheduled_at: now,
    started_at: null,
    finished_at: null,
    created_by: 'user-1',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function createHarness() {
  const afterCommitCallbacks: Array<() => void> = [];
  const tx = {
    accountId: 'acc-1',
    db: {} as AccountTx['db'],
    afterCommit: (fn: () => void) => {
      afterCommitCallbacks.push(fn);
    },
  } as AccountTx;

  const accountDb = {
    transaction: async <T>(fn: (t: AccountTx) => Promise<T>): Promise<T> => {
      const result = await fn(tx);
      for (const cb of afterCommitCallbacks) cb();
      return result;
    },
  } as unknown as AccountDb;

  const tasksRepo = {
    list: jest.fn<TasksRepository['list']>().mockResolvedValue([]),
    listByParents: jest.fn<TasksRepository['listByParents']>().mockResolvedValue([]),
    listSteps: jest.fn<TasksRepository['listSteps']>().mockResolvedValue([]),
    countByStatus: jest.fn<TasksRepository['countByStatus']>().mockResolvedValue({}),
    find: jest.fn<TasksRepository['find']>().mockResolvedValue(undefined),
    transition: jest.fn<TasksRepository['transition']>().mockResolvedValue(undefined),
    closeSteps: jest.fn<TasksRepository['closeSteps']>().mockResolvedValue(undefined),
  } as unknown as TasksRepository;

  const decisionsRepo = {
    findPendingByTask: jest.fn<DecisionsRepository['findPendingByTask']>().mockResolvedValue(undefined),
    decide: jest.fn<DecisionsRepository['decide']>().mockResolvedValue(undefined),
  } as unknown as DecisionsRepository;

  const journal = {
    record: jest.fn<JournalService['record']>().mockResolvedValue(undefined),
  } as unknown as JournalService;

  const outbox = {
    add: jest.fn<OutboxService['add']>().mockResolvedValue(undefined),
  } as unknown as OutboxService;

  const stream = {
    publish: jest.fn<StreamPublisher['publish']>(),
  } as unknown as StreamPublisher;

  const projectContext = {
    actor: () => ({
      accountId: 'acc-1',
      projectId: 'proj-1',
      userId: 'user-1',
      role: 'owner',
    }),
  } as unknown as ProjectContext;

  const service = new TasksService(
    accountDb,
    tasksRepo,
    decisionsRepo,
    journal,
    outbox,
    stream,
    projectContext,
  );

  return { service, tasksRepo, decisionsRepo, stream };
}

describe('TasksService', () => {
  it('loads delegated child tasks up to depth 3 on active tab without duplicates', async () => {
    const { service, tasksRepo } = createHarness();
    const root = makeTaskRow({ id: 't-root', status: 'running' });
    const child = makeTaskRow({ id: 't-child', parent_task_id: 't-root', status: 'planned' });
    const grandChild = makeTaskRow({ id: 't-grand', parent_task_id: 't-child', status: 'waiting' });

    jest.mocked(tasksRepo.list).mockResolvedValue([root]);
    jest
      .mocked(tasksRepo.listByParents)
      .mockResolvedValueOnce([child])
      .mockResolvedValueOnce([grandChild])
      .mockResolvedValueOnce([]);

    const result = await service.list('active');

    expect(result.map((t) => t.id)).toEqual(['t-root', 't-child', 't-grand']);
    expect(tasksRepo.listByParents).toHaveBeenCalledTimes(3);
  });

  it('cancels descendants and expires pending decisions when cancelling a parent task', async () => {
    const { service, tasksRepo, decisionsRepo, stream } = createHarness();
    const root = makeTaskRow({ id: 't-root', status: 'running' });
    const child = makeTaskRow({ id: 't-child', parent_task_id: 't-root', status: 'waiting' });
    const cancelledRoot = { ...root, status: 'cancelled' as const };
    const cancelledChild = { ...child, status: 'cancelled' as const };

    jest.mocked(tasksRepo.find).mockResolvedValue(root);
    jest
      .mocked(tasksRepo.transition)
      .mockResolvedValueOnce(cancelledRoot)
      .mockResolvedValueOnce(cancelledChild);
    jest.mocked(tasksRepo.listByParents).mockResolvedValueOnce([child]).mockResolvedValueOnce([]);
    jest
      .mocked(decisionsRepo.findPendingByTask)
      .mockResolvedValueOnce({ id: 'dec-root' } as Awaited<
        ReturnType<DecisionsRepository['findPendingByTask']>
      >)
      .mockResolvedValueOnce({ id: 'dec-child' } as Awaited<
        ReturnType<DecisionsRepository['findPendingByTask']>
      >)
      .mockResolvedValueOnce(undefined);

    await service.cancel('t-root');

    expect(tasksRepo.closeSteps).toHaveBeenCalledWith(expect.anything(), 't-root', 'failed');
    expect(tasksRepo.closeSteps).toHaveBeenCalledWith(expect.anything(), 't-child', 'failed');
    expect(decisionsRepo.decide).toHaveBeenCalledTimes(2);
    expect(stream.publish).toHaveBeenCalledWith('proj-1', {
      type: 'decision.updated',
      decisionId: 'dec-root',
    });
    expect(stream.publish).toHaveBeenCalledWith('proj-1', {
      type: 'decision.updated',
      decisionId: 'dec-child',
    });
  });

  it('throws WorkException when task is not found', async () => {
    const { service } = createHarness();
    await expect(service.get('missing-id')).rejects.toBeInstanceOf(WorkException);
  });
});
