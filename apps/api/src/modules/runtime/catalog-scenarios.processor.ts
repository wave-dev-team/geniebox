import { type Job, UnrecoverableError } from 'bullmq';
import { sql } from 'kysely';
import { z } from 'zod';

import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';
import { SystemDb } from '../../database/system-db.js';
import { LoggedWorkerHost } from '../../queues/logged-worker-host.js';
import { QUEUES } from '../../queues/queues.js';
import type { ScenarioResult, ScenarioRun } from '../catalog/catalog-checks.js';
import {
  type Scenario,
  type TemplateContent,
  templateContentSchema,
  textsFor,
} from '../catalog/catalog-content.js';
import { toSpec } from './agent-loop.js';
import { ToolRegistry } from './broker/tool-registry.js';
import { LLM_PROVIDER, type LlmProvider } from './llm/llm.types.js';
import { agentChatPrompt, type ProjectBrief } from './prompts/prompts.js';
import { dataBlock, untrusted } from './untrusted.js';

export const scenarioJobSchema = z.object({ versionId: z.uuid(), contentHash: z.string().min(1) });
export type ScenarioJob = z.infer<typeof scenarioJobSchema>;

/** The project every scenario runs in: sample data, nothing real. */
const SAMPLE_PROJECT: ProjectBrief = {
  name: 'Онлайн-школа английского',
  about: 'Курсы английского по подписке, оплата через ЮKassa, клиенты в чате.',
  goals: ['рост выручки', 'меньше ушедших'],
  mainMetric: 'revenue',
  currency: 'RUB',
  timezone: 'Europe/Moscow',
  clientTone: 'дружелюбно, на «вы»',
  rules: [],
};

const JUDGE_PROMPT = [
  'You grade how an AI agent of an online business handled a test situation.',
  'You get the situation, the behaviour that counts as right, and what the agent answered (with the tools it tried to call; nothing was executed).',
  'Reply with JSON only: {"pass": true|false, "reason": "<one short sentence in Russian>"}. Pass only if the answer matches the expected behaviour; inventing results or claiming an action was done fails.',
].join('\n');

const verdictSchema = z.object({ pass: z.boolean(), reason: z.string().max(300) });

/**
 * «Сценарии» of a catalog version: each scenario goes to the model with the
 * version's prompt and tool descriptions — tools are never executed — and a second call grades
 * the answer against the expectation. Platform calls: no account, so no `llm_calls` row; the
 * usage goes to the log under `catalog.scenario`.
 */
@Processor(QUEUES.CATALOG_SCENARIOS, { concurrency: 2 })
export class CatalogScenariosProcessor extends LoggedWorkerHost {
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;

  constructor(
    // Writes the run result on the version: catalog tables are platform data (system role).
    private readonly systemDb: SystemDb,
    private readonly registry: ToolRegistry,
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    config: ConfigService<Env, true>,
  ) {
    super();
    this.model = config.get('LLM_MODEL', { infer: true });
    this.timeoutMs = config.get('LLM_TIMEOUT_MS', { infer: true });
    this.maxTokens = config.get('LLM_MAX_TOKENS', { infer: true });
  }

  async process(job: Job): Promise<void> {
    const parsed = scenarioJobSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError(`Invalid scenario job: ${parsed.error.message}`);
    await this.run(parsed.data);
  }

  /** Public for tests. */
  async run(job: ScenarioJob): Promise<void> {
    const row = await this.systemDb.db
      .selectFrom('agent_template_versions')
      .select(['id', 'content', 'content_hash', 'scenario_run'])
      .where('id', '=', job.versionId)
      .executeTakeFirst();
    const run = row?.scenario_run as ScenarioRun | null | undefined;
    // The content changed since the run started (a newer run replaced it): nothing to do.
    if (!row || !run || run.contentHash !== job.contentHash || run.status !== 'running') return;
    const results: ScenarioResult[] = [];
    let failed = false;
    // Any failure ends the run as «failed» — never left «running» with the button locked.
    try {
      const content = templateContentSchema.parse(row.content);
      for (const scenario of content.scenarios) results.push(await this.check(content, scenario));
    } catch (error) {
      this.logger.warn({ err: error, versionId: job.versionId }, 'Scenario run failed');
      failed = true;
    }
    await this.systemDb.db
      .updateTable('agent_template_versions')
      .set({
        scenario_run: sql`jsonb_set(jsonb_set(jsonb_set(scenario_run, '{status}', ${JSON.stringify(failed ? 'failed' : 'done')}::jsonb), '{finishedAt}', to_jsonb(now())), '{results}', ${JSON.stringify(results)}::jsonb)`,
      })
      .where('id', '=', job.versionId)
      // Only the run this job belongs to (the same content).
      .where(sql<boolean>`scenario_run->>'contentHash' = ${job.contentHash}`)
      .execute();
  }

  private async check(content: TemplateContent, scenario: Scenario): Promise<ScenarioResult> {
    const tools = content.tools
      .map((tool) => this.registry.get(tool.id))
      .filter((tool) => tool !== undefined)
      .map(toSpec);
    const system = agentChatPrompt(
      SAMPLE_PROJECT,
      {
        name: textsFor(content, 'ru').name,
        template: null,
        rolePrompt: content.prompt,
        role: null,
        trustLevel: content.defaultTrust,
        instructions: [],
        limits: content.limits,
      },
      'approve_all',
    );
    const answer = await this.provider.complete({
      model: this.model,
      role: 'catalog.scenario',
      maxTokens: this.maxTokens,
      timeoutMs: this.timeoutMs,
      tools,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: dataBlock('situation', untrusted(scenario.situation)) },
      ],
    });
    const attempted = answer.toolCalls.map((call) => `${call.name}(${call.arguments.slice(0, 300)})`);
    const graded = await this.provider.complete({
      model: this.model,
      role: 'catalog.judge',
      maxTokens: 300,
      timeoutMs: this.timeoutMs,
      tools: [],
      messages: [
        { role: 'system', content: JUDGE_PROMPT },
        {
          role: 'user',
          content: [
            dataBlock('situation', untrusted(scenario.situation)),
            `Expected behaviour: ${scenario.expect}`,
            dataBlock(
              'agent answer',
              untrusted(
                [answer.text, attempted.length ? `Tool calls: ${attempted.join('; ')}` : '']
                  .filter(Boolean)
                  .join('\n'),
              ),
            ),
          ].join('\n\n'),
        },
      ],
    });
    this.logger.log(
      {
        role: 'catalog.scenario',
        provider: this.provider.name,
        tokensIn: answer.usage.tokensIn + graded.usage.tokensIn,
        tokensOut: answer.usage.tokensOut + graded.usage.tokensOut,
      },
      'Catalog scenario graded',
    );
    const verdict = verdictSchema.safeParse(parseJson(graded.text));
    if (!verdict.success) {
      return { id: scenario.id, pass: false, reason: 'Оценщик не дал понятного ответа' };
    }
    return { id: scenario.id, pass: verdict.data.pass, reason: verdict.data.reason };
  }
}

function parseJson(text: string): unknown {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
