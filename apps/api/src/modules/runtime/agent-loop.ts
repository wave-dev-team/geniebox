import { z } from 'zod';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';
import { type BrokerTool, llmToolName, type ToolContext, type ToolOutcome } from './broker/broker.types.js';
import { ToolExecutor } from './broker/tool-executor.js';
import type { LlmCallContext } from './llm/llm.service.js';
import { LlmService } from './llm/llm.service.js';
import type { LlmMessage, LlmToolSpec } from './llm/llm.types.js';
import { dataBlock, untrusted } from './untrusted.js';

export interface LoopResult {
  text: string;
  /** Outcome of the tool that ended the turn (finish, propose, approval). */
  terminal: ToolOutcome | null;
  outcomes: ToolOutcome[];
  /** Ran out of rounds without a final answer. */
  exhausted: boolean;
}

const RESULT_PREVIEW = 3_000;

/**
 * One agent turn: model → tool calls through the broker → results back → … until a final
 * answer, a terminal tool or the round limit. The model never touches anything directly.
 */
@Injectable()
export class AgentLoop {
  private readonly maxSteps: number;

  constructor(
    private readonly llm: LlmService,
    private readonly executor: ToolExecutor,
    config: ConfigService<Env, true>,
  ) {
    this.maxSteps = config.get('AGENT_MAX_STEPS', { infer: true });
  }

  async run(input: {
    llm: LlmCallContext;
    tool: ToolContext;
    messages: LlmMessage[];
    tools: BrokerTool[];
    onTextDelta?: (delta: string) => void;
  }): Promise<LoopResult> {
    const specs = input.tools.map(toSpec);
    const byName = new Map(input.tools.map((tool) => [llmToolName(tool.id), tool.id]));
    const offered = input.tools.map((tool) => tool.id);
    const messages = [...input.messages];
    const outcomes: ToolOutcome[] = [];
    let text = '';
    for (let step = 0; step < this.maxSteps; step++) {
      // The streamed text must match `text` below: steps are joined with a blank line.
      const separator = text ? '\n\n' : '';
      let started = false;
      const onTextDelta = input.onTextDelta
        ? (delta: string) => {
            if (!started && separator) input.onTextDelta!(separator);
            started = true;
            input.onTextDelta!(delta);
          }
        : undefined;
      const response = await this.llm.complete(input.llm, { messages, tools: specs, onTextDelta });
      if (response.text) text += (text ? '\n\n' : '') + response.text;
      if (response.toolCalls.length === 0) {
        return { text, terminal: null, outcomes, exhausted: false };
      }
      messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls });
      let terminal: ToolOutcome | null = null;
      for (const call of response.toolCalls) {
        const toolId = byName.get(call.name) ?? call.name;
        // After a terminal call the rest of the batch is refused: the turn is over.
        const outcome: ToolOutcome = terminal
          ? ({
              status: 'rejected',
              toolId,
              errorCode: 'TURN_ENDED',
              terminal: false,
            } satisfies ToolOutcome)
          : await this.executor.execute(input.tool, toolId, call.arguments, offered);
        outcomes.push(outcome);
        messages.push({ role: 'tool', toolCallId: call.id, content: toolResult(outcome) });
        if (outcome.terminal) terminal = outcome;
      }
      if (terminal) return { text, terminal, outcomes, exhausted: false };
    }
    return { text, terminal: null, outcomes, exhausted: true };
  }
}

export function toSpec(tool: BrokerTool): LlmToolSpec {
  const schema = z.toJSONSchema(tool.schema, { io: 'input' }) as Record<string, unknown>;
  delete schema.$schema;
  return { name: llmToolName(tool.id), description: tool.description, parameters: schema };
}

/** Tool result as the model sees it; provider data is wrapped as untrusted. */
function toolResult(outcome: ToolOutcome): string {
  if (outcome.status === 'executed') {
    const json = JSON.stringify(outcome.result ?? { ok: true }).slice(0, RESULT_PREVIEW);
    return dataBlock(outcome.toolId, untrusted(json));
  }
  if (outcome.status === 'approval') {
    return JSON.stringify({ ok: false, status: 'approval', decisionId: outcome.decisionId });
  }
  return JSON.stringify({
    ok: false,
    status: outcome.status,
    error: outcome.errorCode,
    detail: outcome.result,
  });
}
