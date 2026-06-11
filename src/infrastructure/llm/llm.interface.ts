export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmJsonOptions {
  messages: LlmChatMessage[];
  schema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmChatOptions {
  messages: LlmChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LlmResponse {
  content: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  model?: string;
}

export interface ILLMProvider {
  /** Free-form text chat */
  chat(options: LlmChatOptions): Promise<LlmResponse>;

  /** Structured JSON response */
  json<T = unknown>(options: LlmJsonOptions): Promise<{ data: T; raw: LlmResponse }>;
}

export const LLM_PROVIDER = 'LLM_PROVIDER';
