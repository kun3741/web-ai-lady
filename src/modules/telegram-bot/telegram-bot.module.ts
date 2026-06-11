import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { CallbackHandler } from './handlers/callback.handler';
import { StartCommand } from './commands/start.command';
import { PanicCommand } from './commands/panic.command';
import { ClearAllCommand } from './commands/clear-all.command';
import { MainMenuPanel } from './panels/main-menu.panel';
import { LeadsPanel } from './panels/leads.panel';
import { LeadDetailPanel } from './panels/lead-detail.panel';
import { DraftsPanel } from './panels/drafts.panel';
import { PersonasPanel } from './panels/personas.panel';
import { ImportPanel } from './panels/import.panel';
import { MediaPanel } from './panels/media.panel';
import { BridgePanel } from './panels/bridge.panel';
import { ContentGroupPanel } from './panels/content-group.panel';
import { ContentSendPanel } from './panels/content-send.panel';
import { TextMessageHandler } from './handlers/text-message.handler';
import { DocumentHandler } from './handlers/document.handler';
import { ForwardHandler } from './handlers/forward.handler';
import { MediaUploadHandler } from './handlers/media-upload.handler';
import { SettingsModule } from '@modules/settings/settings.module';
import { ContactsModule } from '@modules/contacts/contacts.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { MessagesModule } from '@modules/messages/messages.module';
import { MemoryModule } from '@modules/memory/memory.module';
import { FunnelModule } from '@modules/funnel/funnel.module';
import { AiModule } from '@modules/ai/ai.module';
import { ImportsModule } from '@modules/imports/imports.module';
import { AnalyticsModule } from '@modules/analytics/analytics.module';
import { AuditModule } from '@modules/audit/audit.module';
import { AutomationModule } from '@modules/automation/automation.module';
import { MediaLibraryModule } from '@modules/media-library/media-library.module';
import { ContentGroupModule } from '@modules/content-group/content-group.module';
import { MongooseModule } from '@nestjs/mongoose';
import { Persona, PersonaSchema } from '@modules/telegram-accounts/schemas/persona.schema';
import { Candidate, CandidateSchema } from '@modules/contacts/schemas/candidate.schema';
import { Message, MessageSchema } from '@modules/messages/schemas/message.schema';
import {
  Conversation,
  ConversationSchema,
} from '@modules/conversations/schemas/conversation.schema';
import { MemoryItem, MemoryItemSchema } from '@modules/memory/schemas/memory-item.schema';
import {
  FunnelStageState,
  FunnelStageStateSchema,
} from '@modules/funnel/schemas/funnel-stage-state.schema';

@Module({
  imports: [
    SettingsModule,
    ContactsModule,
    ConversationsModule,
    MessagesModule,
    MemoryModule,
    FunnelModule,
    AiModule,
    ImportsModule,
    AnalyticsModule,
    AuditModule,
    AutomationModule,
    MediaLibraryModule,
    ContentGroupModule,
    MongooseModule.forFeature([
      { name: Persona.name, schema: PersonaSchema },
      { name: Candidate.name, schema: CandidateSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: MemoryItem.name, schema: MemoryItemSchema },
      { name: FunnelStageState.name, schema: FunnelStageStateSchema },
    ]),
  ],
  providers: [
    BotService,
    CallbackHandler,
    StartCommand,
    PanicCommand,
    ClearAllCommand,
    MainMenuPanel,
    LeadsPanel,
    LeadDetailPanel,
    DraftsPanel,
    PersonasPanel,
    ImportPanel,
    MediaPanel,
    BridgePanel,
    ContentGroupPanel,
    ContentSendPanel,
    TextMessageHandler,
    DocumentHandler,
    ForwardHandler,
    MediaUploadHandler,
  ],
  exports: [BotService],
})
export class TelegramBotModule {}
