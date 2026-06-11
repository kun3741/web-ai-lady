import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Message, MessageSchema } from './schemas/message.schema';
import { MessagesService } from './messages.service';
import { MessageSenderService } from './message-sender.service';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { ContactsModule } from '@modules/contacts/contacts.module';
import { AuditModule } from '@modules/audit/audit.module';
import { Persona, PersonaSchema } from '@modules/telegram-accounts/schemas/persona.schema';
import { TelegramBridgeModule } from '@infrastructure/telegram/telegram-bridge.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { ContentGroupModule } from '@modules/content-group/content-group.module';
import { FunnelModule } from '@modules/funnel/funnel.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Message.name, schema: MessageSchema },
      { name: Persona.name, schema: PersonaSchema },
    ]),
    ConversationsModule,
    ContactsModule,
    AuditModule,
    TelegramBridgeModule,
    SettingsModule,
    ContentGroupModule,
    FunnelModule,
  ],
  providers: [MessagesService, MessageSenderService],
  exports: [MessagesService, MessageSenderService, MongooseModule],
})
export class MessagesModule {}
