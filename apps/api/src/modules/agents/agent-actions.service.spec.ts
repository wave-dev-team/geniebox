import { jest } from '@jest/globals';

import type { AccountDb, AccountTx } from '../../database/scoped-db.js';
import type { ProjectContext } from '../projects/project-context.js';
import { AgentActionsService } from './agent-actions.service.js';
import { AgentException } from './agents.errors.js';
import type { AgentRow, AgentsRepository } from './repositories/agents.repository.js';

describe('AgentActionsService', () => {
  it('throws AgentException when the agent does not exist in the project', async () => {
    const tx = {
      accountId: 'acc-1',
      db: {} as AccountTx['db'],
      afterCommit: jest.fn(),
    } as unknown as AccountTx;

    const accountDb = {
      transaction: async <T>(fn: (t: AccountTx) => Promise<T>): Promise<T> => fn(tx),
    } as unknown as AccountDb;

    const agentsRepo = {
      find: jest.fn<AgentsRepository['find']>().mockResolvedValue(undefined),
    } as unknown as AgentsRepository;

    const projectContext = {
      actor: () => ({
        accountId: 'acc-1',
        projectId: 'proj-1',
        userId: 'user-1',
        role: 'viewer',
      }),
    } as unknown as ProjectContext;

    const service = new AgentActionsService(accountDb, agentsRepo, projectContext);

    await expect(service.page('missing-agent', { period: '7d' })).rejects.toBeInstanceOf(AgentException);
  });

  it('returns empty page when types filter matches nothing after agent check', async () => {
    const fakeQuery = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      execute: jest.fn<() => Promise<never[]>>().mockResolvedValue([]),
    };

    const tx = {
      accountId: 'acc-1',
      db: {
        selectFrom: jest.fn().mockReturnValue(fakeQuery),
      } as unknown as AccountTx['db'],
      afterCommit: jest.fn(),
    } as unknown as AccountTx;

    const accountDb = {
      transaction: async <T>(fn: (t: AccountTx) => Promise<T>): Promise<T> => fn(tx),
    } as unknown as AccountDb;

    const agentsRepo = {
      find: jest.fn<AgentsRepository['find']>().mockResolvedValue({ id: 'agent-1' } as AgentRow),
    } as unknown as AgentsRepository;

    const projectContext = {
      actor: () => ({
        accountId: 'acc-1',
        projectId: 'proj-1',
        userId: 'user-1',
        role: 'viewer',
      }),
    } as unknown as ProjectContext;

    const service = new AgentActionsService(accountDb, agentsRepo, projectContext);
    const page = await service.page('agent-1', { period: '7d', types: 'task' });

    expect(page).toEqual({ items: [], nextCursor: null });
  });
});
