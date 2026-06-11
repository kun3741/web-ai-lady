import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ContentGroupConfig,
  ContentGroupConfigSchema,
} from './schemas/content-group-config.schema';
import { ContentMediaItem, ContentMediaItemSchema } from './schemas/content-media-item.schema';
import { Candidate, CandidateSchema } from '@modules/contacts/schemas/candidate.schema';
import { ContentGroupService } from './content-group.service';
import { TelegramBridgeModule } from '@infrastructure/telegram/telegram-bridge.module';
import { LlmModule } from '@infrastructure/llm/llm.module';
import { TranscriptionModule } from '@modules/transcription/transcription.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ContentGroupConfig.name, schema: ContentGroupConfigSchema },
      { name: ContentMediaItem.name, schema: ContentMediaItemSchema },
      { name: Candidate.name, schema: CandidateSchema },
    ]),
    TelegramBridgeModule,
    LlmModule,
    TranscriptionModule,
  ],
  providers: [ContentGroupService],
  exports: [ContentGroupService],
})
export class ContentGroupModule {}
