import { Injectable, Logger } from '@nestjs/common';

import { AccountDb } from '../../database/scoped-db.js';
import { ResultsRepository } from '../metrics/repositories/results.repository.js';
import { StreamPublisher } from '../stream/stream.publisher.js';
import { TasksRepository } from '../work/repositories/tasks.repository.js';
import { AgentLoop } from './agent-loop.js';
import { ToolRegistry } from './broker/tool-registry.js';
import { LlmBudgetExceededError } from './llm/llm.service.js';
import { LlmFatalError, LlmTransientError } from './llm/llm.types.js';
import { agentTaskPrompt, PROMPT_VERSIONS, withCatalog } from './prompts/prompts.js';
import type { TaskJob } from './runtime.jobs.js';
import { agentBudget, RuntimeContextLoader } from './runtime-context.js';
import { RuntimeTexts } from './runtime-texts.js';
import { TaskLifecycle } from './task-lifecycle.js';
import { dataBlock, maskPersonalData, untrusted } from './untrusted.js';

/**
 * Runs one task: planned → running → done / waiting / failed. The task text may come from the
 * manager's model output, so it reaches the agent as data, not as instructions.
 */
@Injectable()
export class TaskRunner {
  private readonly logger = new Logger(TaskRunner.name);

  constructor(
    private readonly accountDb: AccountDb,
    private readonly tasks: TasksRepository,
    private readonly loader: RuntimeContextLoader,
    private readonly registry: ToolRegistry,
    private readonly loop: AgentLoop,
    private readonly lifecycle: TaskLifecycle,
    private readonly texts: RuntimeTexts,
    private readonly stream: StreamPublisher,
    private readonly results: ResultsRepository,
  ) {}

  async run(job: TaskJob): Promise<void> {
    const lang = await this.loader.locale(job.userId);
    const task = await this.accountDb.transaction((tx) =>
      this.tasks.transition(tx.db, job.taskId, ['planned'], {
        status: 'running',
        started_at: new Date(),
        finished_at: null,
        error: null,
        summary: this.texts.t('runningSummary', lang),
      }),
    );
    // Cancelled, already running (duplicate delivery) or gone: nothing to do.
    if (!task) return;
    await this.accountDb.transaction((tx) =>
      tx.db
        .updateTable('tasks')
        .set((eb) => ({ attempts: eb('attempts', '+', 1) }))
        .where('id', '=', task.id)
        .execute(),
    );
    await this.stream.publish(task.project_id, { type: 'task.updated', taskId: task.id });

    const [project, agent, team, children] = await Promise.all([
      this.loader.project(task.project_id),
      this.loader.agent(task.agent_id),
      this.loader.team(task.project_id),
      this.accountDb.transaction((tx) => this.tasks.listByParent(tx.db, task.id)),
    ]);
    if (!project || !agent || agent.deleted) {
      await this.lifecycle.fail(task, this.texts.error('AGENT_GONE', lang));
      if (task.origin === 'check') await this.closeCheck(task.id, lang);
      return;
    }
    if (agent.runtime.status === 'paused') {
      await this.lifecycle.fail(task, this.texts.error('AGENT_PAUSED', lang));
      if (task.origin === 'check') await this.closeCheck(task.id, lang);
      return;
    }

    const depth = await this.taskDepth(task.parent_task_id);
    const audience = agent.runtime.kind === 'manager' ? 'manager' : 'agent';
    const check = task.origin === 'check';
    const excluded = depth >= 3 ? ['assign_task'] : [];
    const tools = this.registry.available(agent.runtime, audience, excluded, { check });
    const brief = [`${task.title}`, task.description ?? ''].filter(Boolean).join('\n');
    const finishedChildren = children.filter(
      (c) => c.status === 'done' || c.status === 'failed' || c.status === 'cancelled',
    );
    const subtasksBlock =
      finishedChildren.length > 0
        ? '\n\n' +
          dataBlock(
            'subtasks',
            untrusted(
              JSON.stringify(
                finishedChildren.map((c) => ({
                  id: c.id,
                  title: c.title,
                  status: c.status,
                  result: c.result,
                  error: c.error?.what ?? null,
                })),
              ),
            ),
          )
        : '';
    try {
      const result = await this.loop.run({
        llm: {
          projectId: project.id,
          agentId: agent.runtime.id,
          taskId: task.id,
          conversationId: task.conversation_id,
          role: 'agent.task',
          promptVersion: withCatalog(PROMPT_VERSIONS.agentTask, agent.runtime),
          model: agent.runtime.model,
          projectBudgetRub: project.aiBudgetRub,
          agentBudgetRub: agentBudget(agent.runtime),
        },
        tool: {
          accountId: job.accountId,
          projectId: project.id,
          agent: agent.runtime,
          taskId: task.id,
          conversationId: task.conversation_id,
          replyMessageId: null,
          userId: job.userId,
          mode: task.mode as never,
        },
        messages: [
          { role: 'system', content: agentTaskPrompt(project.brief, agent.brief, task.mode, team) },
          {
            role: 'user',
            content: dataBlock('task', untrusted(maskPersonalData(brief))) + subtasksBlock,
          },
        ],
        tools,
      });

      const current = await this.accountDb.transaction((tx) => this.tasks.findById(tx.db, task.id));
      if (!current || current.status !== 'running') return;
      const terminal = result.terminal;
      if (terminal && terminal.status === 'executed' && terminal.toolId === 'finish_task') {
        await this.lifecycle.complete(current, ['running'], {
          status: 'done',
          result: current.result ?? result.text ?? '',
          summary: current.summary,
        });
      } else if (terminal && terminal.status === 'executed' && terminal.toolId === 'record_check') {
        const verdict = (terminal.result as { verdict?: string } | undefined)?.verdict ?? 'inconclusive';
        await this.lifecycle.complete(current, ['running'], {
          status: 'done',
          result: current.result ?? result.text ?? '',
          summary: this.texts.t(`check_${verdict}`, lang),
        });
      } else if (
        terminal &&
        ((terminal.status === 'executed' && terminal.toolId === 'propose_decision') ||
          terminal.status === 'approval')
      ) {
        const decisionId =
          terminal.decisionId ?? (terminal.result as { decisionId?: string } | undefined)?.decisionId;
        if (!decisionId) throw new Error('decision id missing');
        await this.lifecycle.wait(
          current,
          decisionId,
          this.texts.t('waitingStep', lang),
          this.texts.t('waitingSummary', lang),
          result.text || this.texts.t('proposalText', lang),
        );
      } else if (result.exhausted) {
        await this.lifecycle.fail(current, this.texts.error('STEP_LIMIT', lang));
      } else {
        const latestChildren = await this.accountDb.transaction((tx) =>
          this.tasks.listByParent(tx.db, task.id),
        );
        const hasPendingChildren = latestChildren.some(
          (c) => c.status === 'planned' || c.status === 'running' || c.status === 'waiting',
        );
        if (hasPendingChildren) {
          await this.lifecycle.waitForSubtasks(
            current,
            result.text?.slice(0, 200) || this.texts.t('waitingSummary', lang),
          );
        } else {
          await this.lifecycle.complete(current, ['running'], {
            status: 'done',
            result: result.text || current.result || '',
            summary: current.summary,
          });
        }
      }
    } catch (error) {
      const code =
        error instanceof LlmBudgetExceededError
          ? 'BUDGET'
          : error instanceof LlmFatalError || error instanceof LlmTransientError
            ? 'LLM_UNAVAILABLE'
            : 'INTERNAL';
      if (code === 'INTERNAL') this.logger.error({ err: error, taskId: task.id }, 'Task run failed');
      const current = await this.accountDb.transaction((tx) => this.tasks.findById(tx.db, task.id));
      if (current) await this.lifecycle.fail(current, this.texts.error(code, lang));
    } finally {
      if (check) await this.closeCheck(task.id, lang);
    }
  }

  private async taskDepth(parentTaskId: string | null): Promise<number> {
    if (!parentTaskId) return 0;
    return this.accountDb.transaction(async (tx) => {
      let depth = 1;
      let cursorId: string | null = parentTaskId;
      while (cursorId && depth < 4) {
        const parent = await this.tasks.findById(tx.db, cursorId);
        if (!parent?.parent_task_id) break;
        depth++;
        cursorId = parent.parent_task_id;
      }
      return depth;
    });
  }

  /** A check task that ended without a verdict leaves the check failed, not hanging. */
  private async closeCheck(taskId: string, lang: string): Promise<void> {
    await this.accountDb.transaction(async (tx) => {
      const row = await this.results.checkOfTask(tx.db, taskId);
      if (row?.status !== 'running') return;
      await this.results.transitionCheck(tx.db, row.id, ['running'], {
        status: 'failed',
        result: this.texts.t('checkNoVerdict', lang),
        finished_at: new Date(),
      });
    });
  }
}
