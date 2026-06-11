import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const QUEUE_NAMES = {
  MESSAGE_INGESTION: 'message-ingestion',
  AI_DRAFT: 'ai-draft',
  AI_REWRITE: 'ai-rewrite',
  TRANSCRIPTION: 'transcription',
  IMPORT: 'import',
  SCHEDULER: 'scheduler',
  ANALYTICS: 'analytics',
  MEMORY_EXTRACTION: 'memory-extraction',
} as const;

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get('REDIS_PASSWORD', '') || undefined,
          maxRetriesPerRequest: null,
        },
        prefix: config.get('BULLMQ_PREFIX', 'vla'),
        defaultJobOptions: {
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.MESSAGE_INGESTION },
      { name: QUEUE_NAMES.AI_DRAFT },
      { name: QUEUE_NAMES.AI_REWRITE },
      { name: QUEUE_NAMES.TRANSCRIPTION },
      { name: QUEUE_NAMES.IMPORT },
      { name: QUEUE_NAMES.SCHEDULER },
      { name: QUEUE_NAMES.ANALYTICS },
      { name: QUEUE_NAMES.MEMORY_EXTRACTION },
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
