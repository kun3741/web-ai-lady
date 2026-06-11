import { Injectable, Logger } from '@nestjs/common';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { ContactsService } from '@modules/contacts/contacts.service';
import { MessagesService } from '@modules/messages/messages.service';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { MemoryService } from '@modules/memory/memory.service';
import { SettingsService } from '@modules/settings/settings.service';
import { InboundPipelineService } from '@modules/ai/services/inbound-pipeline.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';
import { InlineKeyboard } from 'grammy';

@Injectable()
export class ForwardHandler {
  private readonly logger = new Logger(ForwardHandler.name);

  constructor(
    private readonly contactsService: ContactsService,
    private readonly messagesService: MessagesService,
    private readonly conversationsService: ConversationsService,
    private readonly memoryService: MemoryService,
    private readonly settingsService: SettingsService,
    private readonly inboundPipeline: InboundPipelineService,
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
  ) {}

  /**
   * Check if a message is a forwarded message
   */
  isForwarded(ctx: BotContext): boolean {
    const msg = ctx.message as any;
    if (!msg) return false;
    return !!(
      msg.forward_origin ||
      msg.forward_from ||
      msg.forward_sender_name ||
      msg.forward_date
    );
  }

  async handle(ctx: BotContext): Promise<void> {
    const msg = ctx.message as any;
    if (!msg) return;

    // Determine the forwarded sender info
    let senderTelegramId: string | undefined;
    let senderName = 'Неизвестный';

    // Try forward_from first (user who didn't hide their profile)
    if (msg.forward_from) {
      senderTelegramId = msg.forward_from.id.toString();
      senderName =
        [msg.forward_from.first_name, msg.forward_from.last_name].filter(Boolean).join(' ') ||
        senderTelegramId ||
        'Неизвестный';
    }
    // forward_origin (newer Bot API)
    else if (msg.forward_origin) {
      const origin = msg.forward_origin as any;
      if (origin.type === 'user' && origin.sender_user) {
        senderTelegramId = origin.sender_user.id.toString();
        senderName =
          [origin.sender_user.first_name, origin.sender_user.last_name].filter(Boolean).join(' ') ||
          senderTelegramId ||
          'Неизвестный';
      } else if (origin.type === 'hidden_user') {
        senderName = origin.sender_user_name || 'Скрытый пользователь';
      } else if (origin.sender_user_name) {
        senderName = origin.sender_user_name;
      }
    }
    // Fallback: forward_sender_name (privacy-hidden users)
    else if (msg.forward_sender_name) {
      senderName = msg.forward_sender_name;
    }

    // Get the active persona from session
    const personaId = ctx.session.activePersonaId;
    if (!personaId) {
      await ctx.reply(
        '⚠️ *Не выбран активный аккаунт*\n\n' +
          'Перейдите в «Аккаунты» и выберите персону перед пересылкой сообщений.',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    // Extract message text
    const messageText = msg.text || msg.caption || '';
    if (!messageText) {
      await ctx.reply(
        '⚠️ Переслано сообщение без текста. Пока поддерживаются только текстовые сообщения.',
      );
      return;
    }

    // If we have a telegram ID, try to find or create the candidate
    if (senderTelegramId) {
      try {
        const candidate = await this.contactsService.findOrCreate(
          personaId,
          senderTelegramId,
          senderName,
        );

        // Save as inbound message
        const conv = await this.conversationsService.findOrCreate(
          personaId,
          candidate._id.toString(),
        );
        const savedMsg = await this.messagesService.createMessage({
          conversationId: conv._id,
          personaId: new Types.ObjectId(personaId),
          candidateId: candidate._id,
          telegramMessageId: msg.message_id,
          direction: 'inbound',
          isDraft: false,
          normalizedText: messageText,
          confidence: 1,
          safetyStatus: 'safe',
          sentAt: msg.forward_date ? new Date(msg.forward_date * 1000) : new Date(),
        });

        await ctx.reply(
          `⏳ *Сообщение сохранено!*\n\n` +
            `*От:* ${senderName} (\`${senderTelegramId}\`)\n` +
            `*Текст:* _${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}_\n\n` +
            `Обрабатываю сообщение и генерирую черновик...`,
          { parse_mode: 'Markdown' },
        );

        // Run inbound pipeline (extract memory + generate draft + evaluate automation + auto-send/notify)
        await this.inboundPipeline.processInbound(
          personaId,
          candidate._id.toString(),
          messageText,
          ctx.chat?.id.toString(),
        );
      } catch (err) {
        this.logger.error(`Forward handling failed: ${(err as Error).message}`);
        await ctx.reply(`❌ Ошибка обработки пересланного сообщения: ${(err as Error).message}`);
      }
    } else {
      // No telegram ID — offer to manually link
      const keyboard = new InlineKeyboard().text('🔙 Меню', 'menu');

      await ctx.reply(
        `⚠️ *Не удалось определить отправителя*\n\n` +
          `Отправитель: *${senderName}*\n` +
          `У этого пользователя скрыт профиль. Для сохранения сообщения необходимо указать Telegram ID вручную.\n\n` +
          `💡 _Попросите кандидата написать боту напрямую, или создайте лида вручную через меню «Лиды»._`,
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    }
  }
}
