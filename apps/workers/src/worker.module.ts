import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { RedisModule } from '@infrastructure/redis/redis.module';
import { QueuesModule } from '@infrastructure/queues/queues.module';
import { LlmModule } from '@infrastructure/llm/llm.module';
import { StorageModule } from '@infrastructure/storage/storage.module';
import { MessagesModule } from '@modules/messages/messages.module';
import { ImportsModule } from '@modules/imports/imports.module';
import { TranscriptionModule } from '@modules/transcription/transcription.module';
import { SchedulerModule } from '@modules/scheduler/scheduler.module';
import { MemoryModule } from '@modules/memory/memory.module';
import { AuditModule } from '@modules/audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DatabaseModule,
    RedisModule,
    QueuesModule,
    LlmModule,
    StorageModule,
    MessagesModule,
    ImportsModule,
    TranscriptionModule,
    SchedulerModule,
    MemoryModule,
    AuditModule,
  ],
})
export class WorkerModule {}
