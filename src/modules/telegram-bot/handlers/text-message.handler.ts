import { Injectable, Logger } from '@nestjs/common';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { ContactsService } from '@modules/contacts/contacts.service';
import { SettingsService } from '@modules/settings/settings.service';
import { MessagesService } from '@modules/messages/messages.service';
import { MessageSenderService } from '@modules/messages/message-sender.service';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';
import { InlineKeyboard } from 'grammy';
import { PersonasPanel } from '../panels/personas.panel';
import { BridgePanel } from '../panels/bridge.panel';
import { ContentGroupPanel } from '../panels/content-group.panel';
import { MtprotoBridgeService } from '@infrastructure/telegram/mtproto-bridge.service';

@Injectable()
export class TextMessageHandler {
  private readonly logger = new Logger(TextMessageHandler.name);

  constructor(
    private readonly contactsService: ContactsService,
    private readonly settingsService: SettingsService,
    private readonly messagesService: MessagesService,
    private readonly messageSenderService: MessageSenderService,
    private readonly conversationsService: ConversationsService,
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
    private readonly personasPanel: PersonasPanel,
    private readonly bridgePanel: BridgePanel,
    private readonly contentGroupPanel: ContentGroupPanel,
    private readonly bridgeService: MtprotoBridgeService,
  ) {}

  async handle(ctx: BotContext): Promise<void> {
    const text = ctx.message?.text?.trim();
    if (!text) return;

    const awaiting = ctx.session.awaitingInput;
    if (!awaiting) {
      // No active input flow — show hint
      await ctx.reply('💡 Используйте /start для открытия меню или inline-кнопки для навигации.');
      return;
    }

    switch (awaiting) {
      case 'create_lead_name':
        await this.handleCreateLeadName(ctx, text);
        break;
      case 'create_lead_telegram_id':
        await this.handleCreateLeadTelegramId(ctx, text);
        break;
      case 'create_persona_name':
        await this.handleCreatePersonaName(ctx, text);
        break;
      case 'create_persona_telegram_id':
        await this.handleCreatePersonaTelegramId(ctx, text);
        break;
      case 'edit_persona_biography':
        await this.handleEditPersonaField(ctx, 'biography', text);
        break;
      case 'edit_persona_phone':
        await this.handleEditPersonaField(ctx, 'phone', text);
        break;
      case 'edit_persona_whatsapp':
        await this.handleEditPersonaField(ctx, 'whatsApp', text);
        break;
      case 'edit_persona_payment':
        await this.handleEditPersonaField(ctx, 'paymentDetails', text);
        break;
      case 'edit_persona_media':
        await this.handleEditPersonaField(ctx, 'mediaLibraryTag', text);
        break;
      case 'edit_persona_legend':
        await this.handleEditPersonaField(ctx, 'legend', text);
        break;
      case 'edit_persona_payment_rules':
        await this.handleEditPersonaField(ctx, 'paymentRules', text);
        break;
      case 'bridge_api_id':
        await this.bridgePanel.handleApiIdInput(ctx, text);
        break;
      case 'bridge_api_hash':
        await this.bridgePanel.handleApiHashInput(ctx, text);
        break;
      case 'bridge_phone':
        await this.bridgePanel.handlePhoneInput(ctx, text);
        break;
      case 'bridge_code':
        await this.bridgePanel.handleCodeInput(ctx, text);
        break;
      case 'bridge_2fa':
        await this.bridgePanel.handle2FAInput(ctx, text);
        break;
      case 'edit_content_group_id':
        await this.contentGroupPanel.handleEditGroupIdInput(ctx, text);
        break;
      case 'manual_reply':
        await this.handleManualReply(ctx, text);
        break;
      default:
        ctx.session.awaitingInput = undefined;
        await ctx.reply('⚠️ Неизвестный ввод. Попробуйте снова через меню.');
        break;
    }
  }

  // ─── Lead Creation Flow ───

  private async handleCreateLeadName(ctx: BotContext, name: string): Promise<void> {
    ctx.session.pendingLeadName = name;
    ctx.session.awaitingInput = 'create_lead_telegram_id';
    const personaId = ctx.session.selectedPersonaId;

    const keyboard = new InlineKeyboard().text(
      '🔙 Отмена',
      `leads:list:1${personaId ? `:${personaId}` : ''}`,
    );

    await ctx.reply(
      `👤 Имя: *${name}*\n\n` +
        `Теперь введите Telegram User ID кандидата (числовой ID) или username (например, @username):\n` +
        `_(Например: 123456789 или @AdelSabbagh)_`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  }

  private async handleCreateLeadTelegramId(ctx: BotContext, telegramId: string): Promise<void> {
    const personaId = ctx.session.selectedPersonaId;
    const leadName = ctx.session.pendingLeadName;

    if (!personaId || !leadName) {
      ctx.session.awaitingInput = undefined;
      await ctx.reply('❌ Ошибка: потеряны данные сессии. Начните создание заново через меню.');
      return;
    }

    let resolvedId = telegramId.trim();

    // If it's a username (not purely numeric)
    if (!/^\d+$/.test(resolvedId)) {
      const username = resolvedId.replace('@', '').trim();

      // Basic username check
      if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) {
        await ctx.reply(
          '❌ Telegram ID должен быть либо числовым User ID (например, `123456789`), ' +
            'либо корректным username (например, `@username`). Попробуйте еще раз:',
        );
        return;
      }

      if (!this.bridgeService.isConnected(personaId)) {
        await ctx.reply(
          `❌ Bridge для этого аккаунта не подключен.\n` +
            `Чтобы использовать username, сначала подключите Bridge, либо введите числовой ID вручную:`,
        );
        return;
      }

      const client = this.bridgeService.getClient(personaId);
      if (!client) {
        await ctx.reply('❌ Ошибка: клиент Bridge не найден. Введите числовой ID вручную:');
        return;
      }

      try {
        const resolvingMsg = await ctx.reply('🔍 Поиск пользователя в Telegram...');
        const entity = await client.getEntity(username);
        if (entity && (entity as any).id) {
          resolvedId = (entity as any).id.toString();
          const fullName =
            [(entity as any).firstName, (entity as any).lastName].filter(Boolean).join(' ') ||
            (entity as any).username ||
            resolvedId;
          await ctx.api.deleteMessage(ctx.chat!.id, resolvingMsg.message_id).catch(() => {});
          await ctx.reply(`✅ Пользователь найден: *${fullName}* (ID: \`${resolvedId}\`)`, {
            parse_mode: 'Markdown',
          });
        } else {
          await ctx.api.deleteMessage(ctx.chat!.id, resolvingMsg.message_id).catch(() => {});
          await ctx.reply('❌ Не удалось получить ID пользователя. Введите числовой ID вручную:');
          return;
        }
      } catch (err: any) {
        this.logger.error(`Failed to resolve username ${username}: ${err.message}`);
        await ctx.reply(
          `❌ Пользователь *@${username}* не найден. Проверьте правильность и введите числовой ID вручную:`,
        );
        return;
      }
    }

    try {
      const candidate = await this.contactsService.findOrCreate(personaId, resolvedId, leadName);

      // Clear session
      ctx.session.awaitingInput = undefined;
      ctx.session.pendingLeadName = undefined;
      ctx.session.selectedPersonaId = undefined;

      const keyboard = new InlineKeyboard()
        .text('📋 Открыть карточку', `lead:${candidate._id}`)
        .row()
        .text('🔙 К списку лидов', `leads:list:1:${personaId}`);

      await ctx.reply(
        `✅ *Лид успешно создан!*\n\n` +
          `*Имя:* ${leadName}\n` +
          `*Telegram ID:* \`${resolvedId}\`\n` +
          `*Статус:* 🟢 active`,
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    } catch (err) {
      this.logger.error('Failed to create lead', (err as Error).message);
      ctx.session.awaitingInput = undefined;
      await ctx.reply(`❌ Ошибка создания лида: ${(err as Error).message}`);
    }
  }

  // ─── Persona Creation Flow ───

  private async handleCreatePersonaName(ctx: BotContext, name: string): Promise<void> {
    ctx.session.pendingPersonaName = name;
    ctx.session.awaitingInput = 'create_persona_telegram_id';

    const keyboard = new InlineKeyboard().text('🔙 Отмена', 'personas');

    await ctx.reply(
      `👤 Имя аккаунта: *${name}*\n\n` +
        `Теперь введите Telegram username или ID аккаунта:\n` +
        `*(Например: \`my_lady_account\` или \`123456789\`)*`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  }

  private async handleCreatePersonaTelegramId(
    ctx: BotContext,
    telegramAccountId: string,
  ): Promise<void> {
    const personaName = ctx.session.pendingPersonaName;

    if (!personaName) {
      ctx.session.awaitingInput = undefined;
      await ctx.reply('❌ Ошибка: потеряны данные сессии. Начните создание заново через меню.');
      return;
    }

    try {
      const ws = await this.settingsService.getOrCreateDefault();

      const persona = await this.personaModel.create({
        workspaceId: ws._id,
        name: personaName,
        telegramAccountId: telegramAccountId.replace('@', ''),
        status: 'active',
      });

      // Clear session
      ctx.session.awaitingInput = undefined;
      ctx.session.pendingPersonaName = undefined;

      const keyboard = new InlineKeyboard()
        .text('📋 Открыть аккаунт', `persona_select:${persona._id}`)
        .row()
        .text('🔙 К списку аккаунтов', 'personas:list');

      await ctx.reply(
        `✅ *Аккаунт успешно создан!*\n\n` +
          `*Имя:* ${personaName}\n` +
          `*Telegram ID:* \`@${telegramAccountId.replace('@', '')}\`\n` +
          `*Статус:* 🟢 active`,
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    } catch (err) {
      this.logger.error('Failed to create persona', (err as Error).message);
      ctx.session.awaitingInput = undefined;
      await ctx.reply(`❌ Ошибка создания аккаунта: ${(err as Error).message}`);
    }
  }

  // ─── Persona Edit Field Helper ───

  private async handleEditPersonaField(
    ctx: BotContext,
    field: string,
    value: string,
  ): Promise<void> {
    const personaId = ctx.session.selectedPersonaId;
    if (!personaId || !Types.ObjectId.isValid(personaId)) {
      ctx.session.awaitingInput = undefined;
      ctx.session.selectedPersonaId = undefined;
      await ctx.reply('❌ Ошибка: сессия утеряна. Начните заново.');
      return;
    }

    try {
      const persona = await this.personaModel.findById(personaId).exec();
      if (!persona) {
        ctx.session.awaitingInput = undefined;
        ctx.session.selectedPersonaId = undefined;
        await ctx.reply('❌ Ошибка: персона не найдена.');
        return;
      }

      // Update field
      persona.set(field, value);
      await persona.save();

      // Clear session state
      ctx.session.awaitingInput = undefined;
      ctx.session.selectedPersonaId = undefined;

      await ctx.reply(`✅ *Параметр успешно обновлен!*`, { parse_mode: 'Markdown' });

      // Render updated details
      await this.personasPanel.handleSelect(ctx, [personaId]);
    } catch (err) {
      this.logger.error(`Failed to update persona field ${field}`, (err as Error).message);
      ctx.session.awaitingInput = undefined;
      ctx.session.selectedPersonaId = undefined;
      await ctx.reply(`❌ Ошибка обновления: ${(err as Error).message}`);
    }
  }

  // ─── Manual Reply Flow ───

  private async handleManualReply(ctx: BotContext, text: string): Promise<void> {
    const candidateId = ctx.session.activeCandidateId;
    if (!candidateId || !Types.ObjectId.isValid(candidateId)) {
      ctx.session.awaitingInput = undefined;
      ctx.session.activeCandidateId = undefined;
      await ctx.reply('❌ Ошибка: сессия утеряна. Начните заново.');
      return;
    }

    try {
      const candidate = await this.contactsService.findById(candidateId);
      if (!candidate) {
        ctx.session.awaitingInput = undefined;
        ctx.session.activeCandidateId = undefined;
        await ctx.reply('❌ Ошибка: кандидат не найден.');
        return;
      }

      const personaId = candidate.personaId.toString();
      const conv = await this.conversationsService.findOrCreate(personaId, candidateId);

      // Create draft message first to send through sender service
      const msg = await this.messagesService.createMessage({
        conversationId: conv._id,
        personaId: candidate.personaId,
        candidateId: candidate._id,
        telegramMessageId: Math.floor(Math.random() * 1000000),
        direction: 'outbound',
        isDraft: true,
        normalizedText: text,
        confidence: 1.0,
        safetyStatus: 'safe',
        sentAt: new Date(),
      });

      // Clear session awaiting state before attempting send
      ctx.session.awaitingInput = undefined;
      ctx.session.activeCandidateId = undefined;

      try {
        await this.messageSenderService.sendViaBridge(msg._id.toString());

        const keyboard = new InlineKeyboard().text('🔙 К лиду', `lead:${candidateId}`);
        await ctx.reply(`✅ *Отправлено через Bridge!*`, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      } catch (err: any) {
        if (err.message === 'BRIDGE_NOT_CONNECTED') {
          // Approve locally as fallback
          await this.messagesService.approveDraft(msg._id.toString());

          const keyboard = new InlineKeyboard().text('🔙 К лиду', `lead:${candidateId}`);
          await ctx.reply(
            `⚠️ *Bridge не подключен!*\n\n` +
              `Сообщение записано в БД как отправленное.\n` +
              `Скопируйте и отправьте его вручную:\n\n` +
              `\`${text}\``,
            { parse_mode: 'Markdown', reply_markup: keyboard },
          );
        } else {
          this.logger.error(`Manual reply send failed: ${err.message}`);
          await ctx.reply(`❌ Ошибка отправки: ${err.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error('Failed to handle manual reply', err.message);
      ctx.session.awaitingInput = undefined;
      ctx.session.activeCandidateId = undefined;
      await ctx.reply(`❌ Ошибка: ${err.message}`);
    }
  }
}
