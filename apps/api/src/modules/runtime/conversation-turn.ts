import { Injectable, Logger } from '@nestjs/common';

import { AccountDb } from '../../database/scoped-db.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { StreamPublisher } from '../stream/stream.publisher.js';
import { type MessageReadyEvent, WORK_EVENTS } from '../work/events/work.events.js';
import { ConversationsRepository } from '../work/repositories/conversations.repository.js';
import { CONTEXT_MESSAGES } from '../work/work.constants.js';
import { AgentLoop } from './agent-loop.js';
import { ToolRegistry } from './broker/tool-registry.js';
import { LlmBudgetExceededError } from './llm/llm.service.js';
import type { LlmMessage } from './llm/llm.types.js';
import { agentChatPrompt, managerPrompt, PROMPT_VERSIONS, withCatalog } from './prompts/prompts.js';
import type { TurnJob } from './runtime.jobs.js';
import { agentBudget, RuntimeContextLoader } from './runtime-context.js';
import { RuntimeTexts } from './runtime-texts.js';
import { dataBlock, maskPersonalData, untrusted } from './untrusted.js';

const FLUSH_MS = 120;
/** How often the partial answer is written to the database while it streams. */
const SAVE_MS = 1_000;
const MAX_TEXT = 8_000;

/**
 * Answers a message in a conversation: the manager (delegates with assign_task) or the agent
 * the owner wrote to. The answer is streamed to the project stream as it is written.
 */
@Injectable()
export class ConversationTurn {
  private readonly logger = new Logger(ConversationTurn.name);

  constructor(
    private readonly accountDb: AccountDb,
    private readonly conversations: ConversationsRepository,
    private readonly loader: RuntimeContextLoader,
    private readonly registry: ToolRegistry,
    private readonly loop: AgentLoop,
    private readonly texts: RuntimeTexts,
    private readonly stream: StreamPublisher,
    private readonly outbox: OutboxService,
  ) {}

  async run(job: TurnJob): Promise<void> {
    const loaded = await this.accountDb.transaction(async (tx) => {
      const reply = await this.conversations.findMessage(tx.db, job.replyMessageId);
      const question = await this.conversations.findMessage(tx.db, job.userMessageId);
      if (
        !reply ||
        reply.status !== 'streaming' ||
        !question ||
        !reply.agent_id ||
        question.author_user_id !== job.userId ||
        question.conversation_id !== reply.conversation_id
      )
        return;
      const conversation = await this.conversations.find(tx.db, job.projectId, reply.conversation_id);
      if (!conversation || conversation.created_by !== job.userId || conversation.private_archive) return;
      return { reply, question, conversation };
    });
    if (!loaded) return;
    const { reply, question } = loaded;
    job = { ...job, conversationId: loaded.conversation.id };
    const lang = await this.loader.locale(job.userId);
    const [project, agent] = await Promise.all([
      this.loader.project(job.projectId),
      this.loader.agent(reply.agent_id!),
    ]);
    if (!project || !agent || agent.deleted) {
      await this.finish(
        job,
        reply.id,
        this.texts.t('turnFailed', lang, { what: this.texts.error('AGENT_GONE', lang).what }),
        'failed',
      );
      return;
    }
    if (agent.runtime.kind === 'agent' && agent.runtime.status === 'paused') {
      await this.finish(job, reply.id, this.texts.t('turnPaused', lang), 'done');
      return;
    }

    const isManager = agent.runtime.kind === 'manager';
    const mode = question.mode;
    const shared = await this.loader.managerState(project.id, job.userId);
    if (!shared || shared.role === 'viewer') {
      await this.finish(job, reply.id, '', 'failed');
      return;
    }
    const team = isManager ? await this.loader.team(project.id) : [];
    const system = isManager
      ? managerPrompt(project.brief, team, mode)
      : agentChatPrompt(project.brief, agent.brief, mode);
    const { historySince, ...projectState } = shared;
    const after = loaded.conversation.manager_thread ? historySince : undefined;
    const recent = await this.accountDb.transaction(async (tx) => {
      if (after && !(await this.conversations.findMessage(tx.db, question.id, after))) return undefined;
      return this.conversations.listMessages(tx.db, job.conversationId, CONTEXT_MESSAGES + 2, {
        noticeKinds: [],
        after,
      });
    });
    if (!recent) {
      await this.finish(job, reply.id, '', 'failed');
      return;
    }
    const prior = recent.filter(
      (message) =>
        message.id !== question.id &&
        message.id !== reply.id &&
        message.created_at.getTime() <= question.created_at.getTime() &&
        message.status === 'done' &&
        message.role !== 'system' &&
        message.text.trim(),
    );
    const history: LlmMessage[] = [...prior.slice(-(CONTEXT_MESSAGES - 1)), question].map((message) =>
      message.role === 'user'
        ? { role: 'user', content: maskPersonalData(message.text) }
        : { role: 'assistant', content: message.text },
    );
    const tools = isManager
      ? this.registry.available(
          agent.runtime,
          'manager',
          ['report_progress', 'finish_task', ...(mode === 'recommend_only' ? ['assign_task'] : [])],
          { conversation: true },
        )
      : this.registry.available(agent.runtime, 'agent', ['report_progress', 'finish_task'], {
          conversation: true,
        });

    let buffer = '';
    let timer: NodeJS.Timeout | undefined;
    // Everything streamed so far, saved now and then: a client that (re)loads the conversation
    // mid-answer gets the text instead of an empty placeholder.
    let streamed = '';
    let savedLength = 0;
    let lastSave = Date.now();
    let saving: Promise<void> | undefined;
    let saveTimer: NodeJS.Timeout | undefined;
    const save = () => {
      if (streamed.length === savedLength) return;
      // A save is running: try again when the next interval is up.
      if (saving) {
        saveTimer ??= setTimeout(() => {
          saveTimer = undefined;
          save();
        }, SAVE_MS);
        return;
      }
      const text = streamed.slice(0, MAX_TEXT);
      savedLength = streamed.length;
      lastSave = Date.now();
      saving = this.accountDb
        .transaction((tx) => this.conversations.saveStreamingText(tx.db, reply.id, text))
        .catch((error: unknown) => {
          this.logger.warn({ err: error, messageId: reply.id }, 'Partial answer save failed');
        })
        .finally(() => {
          saving = undefined;
        });
    };
    const flush = () => {
      timer = undefined;
      if (!buffer) return;
      const delta = buffer;
      buffer = '';
      streamed += delta;
      // At most once a second, and once more after the stream pauses (tool calls).
      saveTimer ??= setTimeout(
        () => {
          saveTimer = undefined;
          save();
        },
        Math.max(0, SAVE_MS - (Date.now() - lastSave)),
      );
      void this.stream.publish(project.id, {
        type: 'message.delta',
        recipientUserId: job.userId,
        conversationId: job.conversationId,
        messageId: reply.id,
        delta,
      });
    };
    try {
      const result = await this.loop.run({
        llm: {
          projectId: project.id,
          agentId: agent.runtime.id,
          conversationId: job.conversationId,
          role: isManager ? 'manager.turn' : 'agent.turn',
          promptVersion: isManager
            ? PROMPT_VERSIONS.manager
            : withCatalog(PROMPT_VERSIONS.agentChat, agent.runtime),
          model: agent.runtime.model,
          projectBudgetRub: project.aiBudgetRub,
          agentBudgetRub: agentBudget(agent.runtime),
        },
        tool: {
          accountId: job.accountId,
          projectId: project.id,
          agent: agent.runtime,
          taskId: null,
          conversationId: job.conversationId,
          replyMessageId: reply.id,
          userId: job.userId,
          mode,
        },
        messages: [
          { role: 'system', content: system },
          ...(isManager
            ? [
                {
                  role: 'user' as const,
                  content: dataBlock(
                    'shared_project_state',
                    untrusted(
                      maskPersonalData(
                        JSON.stringify({
                          ...projectState,
                          agentsPaused: project.paused,
                        }),
                      ),
                    ),
                  ),
                },
              ]
            : []),
          ...history,
        ],
        tools,
        onTextDelta: (delta) => {
          buffer += delta;
          timer ??= setTimeout(flush, FLUSH_MS);
        },
      });
      if (timer) clearTimeout(timer);
      flush();
      if (saveTimer) clearTimeout(saveTimer);
      await saving;
      const created = result.outcomes.filter((o) => o.status === 'executed');
      const fallback = created.some((o) => o.toolId === 'propose_decision')
        ? this.texts.t('proposalText', lang)
        : created.some((o) => o.toolId === 'assign_task')
          ? this.texts.t('assignedText', lang)
          : '';
      await this.finish(job, reply.id, result.text || fallback, 'done');
    } catch (error) {
      if (timer) clearTimeout(timer);
      if (saveTimer) clearTimeout(saveTimer);
      await saving;
      const code = error instanceof LlmBudgetExceededError ? 'BUDGET' : 'LLM_UNAVAILABLE';
      if (!(error instanceof LlmBudgetExceededError)) {
        this.logger.warn({ err: error, conversationId: job.conversationId }, 'Conversation turn failed');
      }
      await this.finish(
        job,
        reply.id,
        this.texts.t('turnFailed', lang, { what: this.texts.error(code, lang).what }),
        'failed',
      );
    }
  }

  private async finish(
    job: TurnJob,
    messageId: string,
    text: string,
    status: 'done' | 'failed',
  ): Promise<void> {
    await this.accountDb.transaction(async (tx) => {
      await this.conversations.updateMessage(tx.db, messageId, {
        text: text.slice(0, MAX_TEXT),
        status,
      });
      await this.conversations.touch(tx.db, job.conversationId);
      await this.outbox.add<MessageReadyEvent>(tx, {
        type: WORK_EVENTS.MESSAGE_READY,
        payload: { projectId: job.projectId, conversationId: job.conversationId, messageId },
      });
    });
    await this.stream.publish(job.projectId, {
      type: 'message.updated',
      recipientUserId: job.userId,
      conversationId: job.conversationId,
      messageId,
    });
  }
}
