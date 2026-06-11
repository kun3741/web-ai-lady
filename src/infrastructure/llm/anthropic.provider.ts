import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ILLMProvider, LlmChatOptions, LlmJsonOptions, LlmResponse } from './llm.interface';

@Injectable()
export class AnthropicProvider implements ILLMProvider {
  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.client = new Anthropic({
      apiKey: config.get('ANTHROPIC_API_KEY', ''),
      maxRetries: 3,
    });
    this.model = config.get('ANTHROPIC_MODEL', 'claude-sonnet-4-20250514');
  }

  async chat(options: LlmChatOptions): Promise<LlmResponse> {
    const systemMsg = options.messages.find((m) => m.role === 'system');
    const userMessages = options.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
      system: systemMsg?.content || '',
      messages: userMessages,
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return {
      content: textBlock ? textBlock.text : '',
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
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

    const raw = await this.chat({ ...options, messages: messagesWithFormat });
    let data: T;
    try {
      // Extract JSON from potential markdown fences
      const jsonMatch = raw.content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw.content];
      data = JSON.parse(jsonMatch[1]!.trim()) as T;
    } catch (err) {
      this.logger.error('Failed to parse Anthropic JSON response', raw.content);
      throw new Error(`LLM returned invalid JSON: ${(err as Error).message}`);
    }

    return { data, raw };
  }
}
