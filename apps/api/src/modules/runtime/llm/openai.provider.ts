import { Logger } from '@nestjs/common';

import {
  LlmFatalError,
  type LlmMessage,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmToolCall,
  LlmTransientError,
} from './llm.types.js';

interface ChatChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/** OpenAI Chat Completions with tools, streamed. */
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';
  private readonly logger = new Logger(OpenAiProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map(toOpenAi),
          ...(request.tools.length
            ? {
                tools: request.tools.map((tool) => ({
                  type: 'function',
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                    strict: false,
                  },
                })),
              }
            : {}),
          max_completion_tokens: request.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
        }),
      });
      if (!response.ok || !response.body) {
        throw await this.failure(response);
      }
      return await this.read(response.body, request);
    } catch (error) {
      if (error instanceof LlmTransientError || error instanceof LlmFatalError) throw error;
      if (controller.signal.aborted) throw new LlmTransientError('timeout', 'LLM call timed out');
      throw new LlmTransientError('network', error instanceof Error ? error.message : 'network error');
    } finally {
      clearTimeout(timer);
    }
  }

  private async read(body: ReadableStream<Uint8Array>, request: LlmRequest): Promise<LlmResponse> {
    const decoder = new TextDecoder();
    const calls = new Map<number, LlmToolCall>();
    let text = '';
    let buffer = '';
    let usage = { tokensIn: 0, tokensOut: 0 };
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let parsed: ChatChunk;
        try {
          parsed = JSON.parse(data) as ChatChunk;
        } catch {
          continue;
        }
        if (parsed.usage) {
          usage = {
            tokensIn: parsed.usage.prompt_tokens ?? 0,
            tokensOut: parsed.usage.completion_tokens ?? 0,
          };
        }
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) {
          text += delta.content;
          request.onTextDelta?.(delta.content);
        }
        for (const part of delta?.tool_calls ?? []) {
          const call = calls.get(part.index) ?? { id: '', name: '', arguments: '' };
          if (part.id) call.id = part.id;
          if (part.function?.name) call.name += part.function.name;
          if (part.function?.arguments) call.arguments += part.function.arguments;
          calls.set(part.index, call);
        }
      }
    }
    return { text, toolCalls: [...calls.values()], usage };
  }

  private async failure(response: Response): Promise<Error> {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    this.logger.warn({ status: response.status, detail }, 'OpenAI call failed');
    if (response.status === 429) return new LlmTransientError('rate_limited', 'rate limited');
    if (response.status >= 500) return new LlmTransientError('server_error', `status ${response.status}`);
    return new LlmFatalError(`http_${response.status}`, `status ${response.status}`);
  }
}

function toOpenAi(message: LlmMessage): Record<string, unknown> {
  switch (message.role) {
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content || null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    default:
      return { role: message.role, content: message.content };
  }
}
