import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LLM_PROVIDER } from './llm.interface';
import { OpenAIProvider } from './openai.provider';
import { AnthropicProvider } from './anthropic.provider';

@Module({
  imports: [ConfigModule],
  providers: [
    OpenAIProvider,
    AnthropicProvider,
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService, OpenAIProvider, AnthropicProvider],
      useFactory: (config: ConfigService, openai: OpenAIProvider, anthropic: AnthropicProvider) => {
        const provider = config.get('DEFAULT_LLM_PROVIDER', 'openai');
        return provider === 'anthropic' ? anthropic : openai;
      },
    },
  ],
  exports: [LLM_PROVIDER, OpenAIProvider, AnthropicProvider],
})
export class LlmModule {}
