import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ILLMProvider, LlmChatOptions, LlmJsonOptions, LlmResponse } from './llm.interface';

@Injectable()
export class OpenAIProvider implements ILLMProvider {
  private readonly logger = new Logger(OpenAIProvider.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: config.get('OPENAI_API_KEY', ''),
      baseURL: config.get('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
      maxRetries: 3,
    });
    this.model = config.get('OPENAI_MODEL', 'gpt-4o');
  }

  async chat(options: LlmChatOptions): Promise<LlmResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
    });

    const choice = response.choices[0];
    return {
      content: choice?.message?.content || '',
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
      model: response.model,
    };
  }

  async json<T = unknown>(options: LlmJsonOptions): Promise<{ data: T; raw: LlmResponse }> {
    const messagesWithFormat = [...options.messages];
    if (options.schema) {
      const lastMsg = messagesWithFormat[messagesWithFormat.length - 1];
      if (lastMsg) {
        lastMsg.content += `\n\nRespond ONLY with valid JSON matching this schema:\n${JSON.stringify(options.schema, null, 2)}`;
      }
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messagesWithFormat,
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 4096,
      response_format: { type: 'json_object' },
    });

    const choice = response.choices[0];
    const content = choice?.message?.content || '{}';
    const raw: LlmResponse = {
      content,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
      model: response.model,
    };

    let data: T;
    try {
      data = JSON.parse(content) as T;
    } catch (err) {
      this.logger.error('Failed to parse LLM JSON response', content);
      throw new Error(`LLM returned invalid JSON: ${(err as Error).message}`);
    }

    return { data, raw };
  }
}
