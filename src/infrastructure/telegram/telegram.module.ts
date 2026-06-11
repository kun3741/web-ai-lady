import { Module, Global, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Bot, session } from 'grammy';
import { Persona, PersonaSchema } from '@modules/telegram-accounts/schemas/persona.schema';
import { Candidate, CandidateSchema } from '@modules/contacts/schemas/candidate.schema';
import { TelegramBridgeModule } from './telegram-bridge.module';
import { MtprotoListenerService } from './mtproto-listener.service';
import { ContactsModule } from '@modules/contacts/contacts.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { MessagesModule } from '@modules/messages/messages.module';
import { MemoryModule } from '@modules/memory/memory.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { AiModule } from '@modules/ai/ai.module';
import { BOT_INSTANCE, SessionData, BotContext } from './telegram.constants';
export * from './telegram.constants';

@Global()
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Persona.name, schema: PersonaSchema },
      { name: Candidate.name, schema: CandidateSchema },
    ]),
    TelegramBridgeModule,
    ContactsModule,
    ConversationsModule,
    MessagesModule,
    MemoryModule,
    SettingsModule,
    AiModule,
  ],
  providers: [
    {
      provide: BOT_INSTANCE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const token = config.get<string>('TELEGRAM_ADMIN_BOT_TOKEN', '');
        if (!token || token === 'your-bot-token-here') {
          const logger = new Logger('TelegramInfraModule');
          logger.warn('TELEGRAM_ADMIN_BOT_TOKEN not set — bot will not start');
          return null;
        }
        const bot = new Bot<BotContext>(token);
        bot.use(
          session({
            initial: (): SessionData => ({
              activePersonaId: undefined,
              activeCandidateId: undefined,
              panelMessageId: undefined,
              awaitingInput: undefined,
              selectedPersonaId: undefined,
              pendingLeadName: undefined,
              pendingPersonaName: undefined,
              awaitingImportPersonaId: undefined,
              bridgePersonaId: undefined,
              bridgePendingApiId: undefined,
              bridgePendingApiHash: undefined,
              bridgePendingPhone: undefined,
            }),
          }),
        );
        return bot;
      },
    },
    MtprotoListenerService,
  ],
  exports: [BOT_INSTANCE, TelegramBridgeModule, MtprotoListenerService],
})
export class TelegramInfraModule {}
