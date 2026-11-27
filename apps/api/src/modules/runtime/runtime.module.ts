import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';
import { QUEUE_JOB_OPTIONS, QUEUES } from '../../queues/queues.js';
import { ActionsModule } from '../actions/actions.module.js';
import { ConnectionsWorkerModule } from '../connections/connections.module.js';
import { KnowledgeDataModule } from '../knowledge/knowledge.module.js';
import { MetricsDataModule } from '../metrics/metrics.module.js';
import { WorkDataModule } from '../work/work.module.js';
import { AgentLoop } from './agent-loop.js';
import { KillSwitch } from './broker/kill-switch.js';
import { ToolExecutor } from './broker/tool-executor.js';
import { ToolRegistry } from './broker/tool-registry.js';
import { CatalogScenariosProcessor } from './catalog-scenarios.processor.js';
import { ConversationTurn } from './conversation-turn.js';
import { DecisionExecutor } from './decision-executor.js';
import { FakeProvider } from './llm/fake.provider.js';
import { LlmService } from './llm/llm.service.js';
import { LLM_PROVIDER, type LlmProvider } from './llm/llm.types.js';
import { OpenAiProvider } from './llm/openai.provider.js';
import { ManagerNotifications } from './manager-notifications.js';
import { AgentTasksProcessor, AgentTurnsProcessor } from './runtime.processors.js';
import { RuntimeContextLoader } from './runtime-context.js';
import { RuntimeTexts } from './runtime-texts.js';
import { RuntimeWorker } from './runtime-worker.js';
import { TaskLifecycle } from './task-lifecycle.js';
import { TaskRunner } from './task-runner.js';
import { DataTools } from './tools/data-tools.js';
import { KnowledgeTools } from './tools/knowledge-tools.js';
import { PanelTools } from './tools/panel-tools.js';
import { PlatformTools } from './tools/platform-tools.js';
import { ResultsTools } from './tools/results-tools.js';

const llmProvider = {
  provide: LLM_PROVIDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): LlmProvider =>
    config.get('LLM_PROVIDER', { infer: true }) === 'openai'
      ? new OpenAiProvider(
          config.get('OPENAI_API_KEY', { infer: true }),
          config.get('OPENAI_BASE_URL', { infer: true }),
        )
      : new FakeProvider(),
};

/**
 * Agent runtime (worker only): LLM client, broker with its tools, conversation turns, task
 * runs, decisions and routines.
 */
@Module({
  imports: [
    WorkDataModule,
    MetricsDataModule,
    KnowledgeDataModule,
    ConnectionsWorkerModule,
    ActionsModule,
    BullModule.registerQueue(
      { name: QUEUES.AGENT_TURNS, defaultJobOptions: QUEUE_JOB_OPTIONS[QUEUES.AGENT_TURNS] },
      { name: QUEUES.AGENT_TASKS, defaultJobOptions: QUEUE_JOB_OPTIONS[QUEUES.AGENT_TASKS] },
      {
        name: QUEUES.CATALOG_SCENARIOS,
        defaultJobOptions: QUEUE_JOB_OPTIONS[QUEUES.CATALOG_SCENARIOS],
      },
    ),
  ],
  providers: [
    llmProvider,
    LlmService,
    ToolRegistry,
    KillSwitch,
    ToolExecutor,
    PlatformTools,
    PanelTools,
    DataTools,
    KnowledgeTools,
    ResultsTools,
    AgentLoop,
    RuntimeContextLoader,
    RuntimeTexts,
    TaskLifecycle,
    TaskRunner,
    ConversationTurn,
    DecisionExecutor,
    RuntimeWorker,
    ManagerNotifications,
    AgentTurnsProcessor,
    AgentTasksProcessor,
    CatalogScenariosProcessor,
  ],
  exports: [ToolExecutor, ToolRegistry],
})
export class RuntimeWorkerModule {}
