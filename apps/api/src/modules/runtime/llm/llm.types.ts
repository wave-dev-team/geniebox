/** Provider-neutral chat model contract. */

export interface LlmToolCall {
  id: string;
  /** Provider-safe name (dots replaced), mapped back by the runtime. */
  name: string;
  /** Raw JSON text from the model: untrusted, parsed by zod in the broker. */
  arguments: string;
}

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface LlmToolSpec {
  name: string;
  description: string;
  /** JSON schema of the arguments (from the tool's zod schema). */
  parameters: Record<string, unknown>;
}

export interface LlmRequest {
  model: string;
  messages: LlmMessage[];
  tools: LlmToolSpec[];
  maxTokens: number;
  timeoutMs: number;
  /** Streams answer text as it is generated. */
  onTextDelta?: (delta: string) => void;
  /** Hint for deterministic providers: who is asking (role of the prompt). */
  role: string;
}

export interface LlmUsage {
  tokensIn: number;
  tokensOut: number;
}

export interface LlmResponse {
  text: string;
  toolCalls: LlmToolCall[];
  usage: LlmUsage;
}

export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Provider failures the client retries: rate limit, server error, timeout. */
export class LlmTransientError extends Error {
  constructor(
    readonly code: 'rate_limited' | 'server_error' | 'timeout' | 'network',
    message: string,
  ) {
    super(message);
  }
}

/** Failures that do not get better on retry: auth, bad request, content policy. */
export class LlmFatalError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
