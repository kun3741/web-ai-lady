import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ImportJob, ImportJobSchema } from './schemas/import-job.schema';
import { ImportsService } from './imports.service';
import { ImportProcessor } from './processors/import.processor';
import { TelegramJsonParser } from './parsers/telegram-json.parser';
import { StyleExtractorService } from './extractors/style-extractor.service';
import { ContactsModule } from '@modules/contacts/contacts.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { MessagesModule } from '@modules/messages/messages.module';
import { MemoryModule } from '@modules/memory/memory.module';
import { FunnelModule } from '@modules/funnel/funnel.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { QueuesModule } from '@infrastructure/queues/queues.module';
import { Persona, PersonaSchema } from '@modules/telegram-accounts/schemas/persona.schema';
import { PromptProfile, PromptProfileSchema } from '@modules/prompting/schemas/prompt-profile.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ImportJob.name, schema: ImportJobSchema },
      { name: Persona.name, schema: PersonaSchema },
      { name: PromptProfile.name, schema: PromptProfileSchema },
    ]),
    QueuesModule,
    ContactsModule,
    ConversationsModule,
    MessagesModule,
    MemoryModule,
    FunnelModule,
    SettingsModule,
  ],
  providers: [ImportsService, ImportProcessor, TelegramJsonParser, StyleExtractorService],
  exports: [ImportsService, MongooseModule],
})
export class ImportsModule {}
