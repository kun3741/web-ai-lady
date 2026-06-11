import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { RedisModule } from '@infrastructure/redis/redis.module';
import { QueuesModule } from '@infrastructure/queues/queues.module';
import { StorageModule } from '@infrastructure/storage/storage.module';
import { LlmModule } from '@infrastructure/llm/llm.module';
import { TelegramInfraModule } from '@infrastructure/telegram/telegram.module';
import { TelegramBotModule } from '@modules/telegram-bot/telegram-bot.module';
import { ContactsModule } from '@modules/contacts/contacts.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { MessagesModule } from '@modules/messages/messages.module';
import { MemoryModule } from '@modules/memory/memory.module';
import { FunnelModule } from '@modules/funnel/funnel.module';
import { AiModule } from '@modules/ai/ai.module';
import { PromptingModule } from '@modules/prompting/prompting.module';
import { MediaLibraryModule } from '@modules/media-library/media-library.module';
import { TranscriptionModule } from '@modules/transcription/transcription.module';
import { AutomationModule } from '@modules/automation/automation.module';
import { SchedulerModule } from '@modules/scheduler/scheduler.module';
import { AnalyticsModule } from '@modules/analytics/analytics.module';
import { AuditModule } from '@modules/audit/audit.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { ImportsModule } from '@modules/imports/imports.module';

@ApiTags('Health')
@Controller()
class HealthController {
  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DatabaseModule,
    RedisModule,
    QueuesModule,
    StorageModule,
    LlmModule,
    TelegramInfraModule,
    TelegramBotModule,
    ContactsModule,
    ConversationsModule,
    MessagesModule,
    MemoryModule,
    FunnelModule,
    AiModule,
    PromptingModule,
    MediaLibraryModule,
    TranscriptionModule,
    AutomationModule,
    SchedulerModule,
    AnalyticsModule,
    AuditModule,
    SettingsModule,
    ImportsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
