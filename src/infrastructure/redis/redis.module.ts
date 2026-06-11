import { Module, Global, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('RedisModule');
        const client = new Redis({
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get('REDIS_PASSWORD', '') || undefined,
          maxRetriesPerRequest: null, // Required for BullMQ
          enableReadyCheck: true,
          retryStrategy: (times: number) => Math.min(times * 200, 5000),
        });
        client.on('connect', () => logger.log('Redis connected'));
        client.on('error', (err) => logger.error('Redis error', err.message));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(private readonly config: ConfigService) {}

  async onModuleDestroy() {
    // Redis client cleanup handled by NestJS DI container
  }
}
