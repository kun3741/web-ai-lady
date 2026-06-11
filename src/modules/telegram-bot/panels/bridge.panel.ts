import { Injectable, Logger } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { MtprotoBridgeService } from '@infrastructure/telegram/mtproto-bridge.service';
import { MtprotoListenerService } from '@infrastructure/telegram/mtproto-listener.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';
import { ContactsService } from '@modules/contacts/contacts.service';
import { MessagesService } from '@modules/messages/messages.service';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { Message } from '@modules/messages/schemas/message.schema';

@Injectable()
export class BridgePanel {
  private readonly logger = new Logger(BridgePanel.name);

  /** Temporary storage for phone code hashes during auth flow */
  private readonly pendingCodeHashes = new Map<string, string>();

  constructor(
    private readonly bridge: MtprotoBridgeService,
    private readonly listener: MtprotoListenerService,
    private readonly contactsService: ContactsService,
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    private readonly messagesService: MessagesService,
    private readonly conversationsService: ConversationsService,
  ) {}

  async handleAction(ctx: BotContext, params: string[]): Promise<void> {
    const action = params[0] || 'menu';
    const personaId = params[1] || ctx.session.bridgePersonaId;

    if (action === 'menu' && personaId) {
      await this.renderMenu(ctx, personaId);
    } else if (action === 'start_auth' && personaId) {
      await this.startAuthFlow(ctx, personaId);
    } else if (action === 'disconnect' && personaId) {
      await this.handleDisconnect(ctx, personaId);
    } else if (action === 'sync' && personaId) {
      await this.handleSync(ctx, personaId);
    }
  }

  /**
   * Main bridge menu for a persona
   */
  async renderMenu(ctx: BotContext, personaId: string): Promise<void> {
    const persona = await this.personaModel.findById(personaId).exec();
    if (!persona) {
      await ctx.reply('❌ Персона не найдена.');
      return;
    }

    const isConnected = this.bridge.isConnected(personaId);
    const statusEmoji = isConnected ? '🟢' : '🔴';
    const statusText = isConnected ? 'Подключен' : 'Не подключен';

    const keyboard = new InlineKeyboard();

    if (isConnected) {
      keyboard.text('🔄 Синхронизировать чаты', `bridge:sync:${personaId}`).row();
      keyboard.text('🔌 Отключить', `bridge:disconnect:${personaId}`).row();
    } else {
      keyboard.text('🔗 Подключить аккаунт', `bridge:start_auth:${personaId}`).row();
    }

    keyboard.text('🔙 К аккаунту', `persona_select:${personaId}`);

    const defaultApiId = process.env.TELEGRAM_API_ID;
    const displayApiId =
      persona.mtprotoApiId || (defaultApiId ? parseInt(defaultApiId, 10) : undefined);

    const text =
      `🔗 *MTProto Bridge — ${persona.name}*\n\n` +
      `*Статус:* ${statusEmoji} ${statusText}\n` +
      `*Телефон:* \`${persona.mtprotoPhone || 'Не указан'}\`\n` +
      `*API ID:* \`${displayApiId || 'Не указан'}\`\n\n` +
      (isConnected
        ? `✅ Bridge активен. Бот может отправлять сообщения от имени этого аккаунта и принимать входящие.`
        : `⚠️ Bridge не подключен. Нажмите «🔗 Подключить аккаунт» для авторизации.\n\n` +
          (defaultApiId
            ? `💡 _Используются общие API ключи. Понадобится только номер телефона и код._`
            : `💡 _Вам понадобятся api\\_id и api\\_hash с [my.telegram.org](https://my.telegram.org)_`));

    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  }

  /**
   * Start the auth flow — ask for API ID
   */
  async startAuthFlow(ctx: BotContext, personaId: string): Promise<void> {
    ctx.session.bridgePersonaId = personaId;

    const defaultApiId = process.env.TELEGRAM_API_ID;
    const defaultApiHash = process.env.TELEGRAM_API_HASH;

    if (defaultApiId && defaultApiHash) {
      ctx.session.bridgePendingApiId = parseInt(defaultApiId, 10);
      ctx.session.bridgePendingApiHash = defaultApiHash;
      ctx.session.awaitingInput = 'bridge_phone';

      const keyboard = new InlineKeyboard().text('❌ Отмена', `bridge:menu:${personaId}`);
      await ctx.editMessageText(
        `🔑 *Подключение MTProto Bridge*\n\n` +
          `Используются общие API ключи.\n\n` +
          `*Шаг 1 из 2:* Введите номер телефона аккаунта (в международном формате, например: \`+380XXXXXXXXX\`)`,
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
      return;
    }

    ctx.session.awaitingInput = 'bridge_api_id';
    const keyboard = new InlineKeyboard().text('❌ Отмена', `bridge:menu:${personaId}`);
    await ctx.editMessageText(
      `🔑 *Подключение MTProto Bridge*\n\n` +
        `*Шаг 1 из 4:* Введите \`api_id\` (число)\n\n` +
        `💡 _Получите api_id на [my.telegram.org](https://my.telegram.org) → API development tools_`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  }

  /**
   * Handle API ID input → ask for API Hash
   */
  async handleApiIdInput(ctx: BotContext, apiIdStr: string): Promise<void> {
    const apiId = parseInt(apiIdStr, 10);
    if (isNaN(apiId) || apiId <= 0) {
      await ctx.reply('❌ API ID должен быть числом. Попробуйте снова:');
      return;
    }

    ctx.session.bridgePendingApiId = apiId;
    ctx.session.awaitingInput = 'bridge_api_hash';

    await ctx.reply(
      `✅ API ID: \`${apiId}\`\n\n` + `*Шаг 2 из 4:* Введите \`api_hash\` (строка из 32 символов)`,
      { parse_mode: 'Markdown' },
    );
  }

  /**
   * Handle API Hash input → ask for phone number
   */
  async handleApiHashInput(ctx: BotContext, apiHash: string): Promise<void> {
    if (!apiHash || apiHash.length < 10) {
      await ctx.reply(
        '❌ API Hash выглядит некорректно. Должен быть 32 символа. Попробуйте снова:',
      );
      return;
    }

    ctx.session.bridgePendingApiHash = apiHash.trim();
    ctx.session.awaitingInput = 'bridge_phone';

    await ctx.reply(
      `✅ API Hash сохранён.\n\n` +
        `*Шаг 3 из 4:* Введите номер телефона аккаунта (в международном формате, например: \`+380XXXXXXXXX\`)`,
      { parse_mode: 'Markdown' },
    );
  }

  /**
   * Handle phone input → send code
   */
  async handlePhoneInput(ctx: BotContext, phone: string): Promise<void> {
    const personaId = ctx.session.bridgePersonaId;
    const apiId = ctx.session.bridgePendingApiId;
    const apiHash = ctx.session.bridgePendingApiHash;

    if (!personaId || !apiId || !apiHash) {
      ctx.session.awaitingInput = undefined;
      await ctx.reply('❌ Данные сессии утеряны. Начните подключение заново через меню Bridge.');
      return;
    }

    const phoneClean = phone.trim().replace(/\s/g, '');
    if (!phoneClean.startsWith('+') || phoneClean.length < 10) {
      await ctx.reply(
        '❌ Номер должен начинаться с + и содержать не менее 10 цифр. Попробуйте снова:',
      );
      return;
    }

    ctx.session.bridgePendingPhone = phoneClean;

    try {
      await ctx.reply('⏳ Отправляю код подтверждения...');

      // Save API credentials to persona
      await this.personaModel
        .findByIdAndUpdate(personaId, {
          mtprotoApiId: apiId,
          mtprotoApiHash: apiHash,
          mtprotoPhone: phoneClean,
        })
        .exec();

      const { phoneCodeHash } = await this.bridge.startAuth(personaId, apiId, apiHash, phoneClean);

      this.pendingCodeHashes.set(personaId, phoneCodeHash);
      ctx.session.awaitingInput = 'bridge_code';

      const defaultApiId = process.env.TELEGRAM_API_ID;
      const isDefault = apiId === (defaultApiId ? parseInt(defaultApiId, 10) : 0);
      const stepText = isDefault ? 'Шаг 2 из 2' : 'Шаг 4 из 4';

      await ctx.reply(
        `📲 *Код отправлен на ${phoneClean}*\n\n` +
          `*${stepText}:* Введите код подтверждения из Telegram`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      this.logger.error(`Bridge auth start failed: ${(err as Error).message}`);
      ctx.session.awaitingInput = undefined;
      await ctx.reply(`❌ Ошибка отправки кода: ${(err as Error).message}`);
    }
  }

  /**
   * Handle verification code input
   */
  async handleCodeInput(ctx: BotContext, code: string): Promise<void> {
    const personaId = ctx.session.bridgePersonaId;
    const phone = ctx.session.bridgePendingPhone;

    if (!personaId || !phone) {
      ctx.session.awaitingInput = undefined;
      await ctx.reply('❌ Данные сессии утеряны. Начните подключение заново.');
      return;
    }

    const phoneCodeHash = this.pendingCodeHashes.get(personaId);
    if (!phoneCodeHash) {
      ctx.session.awaitingInput = undefined;
      await ctx.reply('❌ Код верификации истёк. Начните подключение заново.');
      return;
    }

    try {
      await ctx.reply('⏳ Проверяю код...');

      await this.bridge.completeAuth(personaId, phone, code.trim(), phoneCodeHash);

      // Clean up
      this.pendingCodeHashes.delete(personaId);
      ctx.session.awaitingInput = undefined;
      ctx.session.bridgePersonaId = undefined;
      ctx.session.bridgePendingApiId = undefined;
      ctx.session.bridgePendingApiHash = undefined;
      ctx.session.bridgePendingPhone = undefined;

      // Set up message listener
      await this.listener.setupListener(personaId);

      const keyboard = new InlineKeyboard()
        .text('🔗 Bridge меню', `bridge:menu:${personaId}`)
        .row()
        .text('🔙 Меню', 'menu');

      await ctx.reply(
        `✅ *MTProto Bridge подключён!*\n\n` +
          `Аккаунт успешно авторизован. Бот теперь может:\n` +
          `• Отправлять сообщения от имени этого аккаунта\n` +
          `• Принимать входящие сообщения`,
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    } catch (err) {
      const errorMessage = (err as Error).message;
      if (errorMessage === '2FA_REQUIRED') {
        ctx.session.awaitingInput = 'bridge_2fa';
        await ctx.reply(
          `🔐 *Двухфакторная аутентификация*\n\nВведите пароль 2FA для этого аккаунта:`,
          { parse_mode: 'Markdown' },
        );
      } else {
        this.logger.error(`Bridge code verification failed: ${errorMessage}`);
        ctx.session.awaitingInput = undefined;
        this.pendingCodeHashes.delete(personaId!);
        await ctx.reply(`❌ Ошибка верификации: ${errorMessage}`);
      }
    }
  }

  /**
   * Handle 2FA password input
   */
  async handle2FAInput(ctx: BotContext, password: string): Promise<void> {
    const personaId = ctx.session.bridgePersonaId;
    const phone = ctx.session.bridgePendingPhone;

    if (!personaId || !phone) {
      ctx.session.awaitingInput = undefined;
      await ctx.reply('❌ Данные сессии утеряны. Начните подключение заново.');
      return;
    }

    const phoneCodeHash = this.pendingCodeHashes.get(personaId);
    if (!phoneCodeHash) {
      ctx.session.awaitingInput = undefined;
      await ctx.reply('❌ Сессия истекла. Начните подключение заново.');
      return;
    }

    try {
      await ctx.reply('⏳ Проверяю 2FA пароль...');

      await this.bridge.completeAuth(
        personaId,
        phone,
        '', // code not needed for 2FA step
        phoneCodeHash,
        password.trim(),
      );

      // Clean up
      this.pendingCodeHashes.delete(personaId);
      ctx.session.awaitingInput = undefined;
      ctx.session.bridgePersonaId = undefined;
      ctx.session.bridgePendingApiId = undefined;
      ctx.session.bridgePendingApiHash = undefined;
      ctx.session.bridgePendingPhone = undefined;

      // Set up message listener
      await this.listener.setupListener(personaId);

      const keyboard = new InlineKeyboard()
        .text('🔗 Bridge меню', `bridge:menu:${personaId}`)
        .row()
        .text('🔙 Меню', 'menu');

      await ctx.reply(`✅ *MTProto Bridge подключён!*\n\nАккаунт успешно авторизован с 2FA.`, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (err) {
      this.logger.error(`Bridge 2FA failed: ${(err as Error).message}`);
      ctx.session.awaitingInput = undefined;
      this.pendingCodeHashes.delete(personaId!);
      await ctx.reply(`❌ Ошибка 2FA: ${(err as Error).message}`);
    }
  }

  /**
   * Disconnect bridge
   */
  async handleDisconnect(ctx: BotContext, personaId: string): Promise<void> {
    try {
      this.listener.removeListener(personaId);
      await this.bridge.disconnect(personaId);

      const keyboard = new InlineKeyboard()
        .text('🔗 Bridge меню', `bridge:menu:${personaId}`)
        .row()
        .text('🔙 Меню', 'menu');

      await ctx.editMessageText(
        `🔌 *Bridge отключён*\n\nМожете подключить заново в любой момент.`,
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    } catch (err) {
      await ctx.reply(`❌ Ошибка отключения: ${(err as Error).message}`);
    }
  }

  /**
   * Sync active user chats
   */
  async handleSync(ctx: BotContext, personaId: string): Promise<void> {
    try {
      const syncStatusMsg = await ctx.reply(
        '⏳ Получаю список последних чатов и сообщений из Telegram...',
      );

      const client = this.bridge.getClient(personaId);
      if (!client) {
        throw new Error('Мост не подключен.');
      }

      const me = await client.getMe();
      const myId = me ? me.id.toString() : '';

      const dialogs = await this.bridge.getRecentDialogs(personaId, 40);
      let count = 0;
      let totalMessagesSynced = 0;

      for (const d of dialogs) {
        // Skip bots and ourselves
        if (d.bot) continue;
        if (myId && d.id === myId) continue;

        // Create lead
        const candidate = await this.contactsService.findOrCreate(personaId, d.id, d.name);

        // Fetch recent messages from Telegram for this dialog to populate database history
        try {
          const idVal = /^-?\d+$/.test(d.id) ? BigInt(d.id) : d.id;
          const messages = await client.getMessages(idVal as any, { limit: 100 });
          const conv = await this.conversationsService.findOrCreate(
            personaId,
            candidate._id.toString(),
          );

          let importCount = 0;
          for (const msg of messages) {
            // Save messages if they don't exist yet
            const exists = await this.messageModel.exists({
              conversationId: conv._id,
              telegramMessageId: msg.id,
            });
            if (!exists) {
              await this.messagesService.createMessage({
                conversationId: conv._id,
                personaId: new Types.ObjectId(personaId),
                candidateId: candidate._id,
                telegramMessageId: msg.id,
                direction: msg.out ? 'outbound' : 'inbound',
                isDraft: false,
                normalizedText: msg.message || '',
                confidence: 1,
                safetyStatus: 'safe',
                sentAt: new Date(msg.date * 1000),
              });
              importCount++;
            }
          }
          totalMessagesSynced += importCount;
          this.logger.debug(`Synced ${importCount} historical messages for candidate ${d.name}`);
        } catch (e: any) {
          this.logger.error(`Failed to fetch messages for dialog ${d.id}: ${e.message}`);
        }

        count++;
      }

      await ctx.api.deleteMessage(ctx.chat!.id, syncStatusMsg.message_id).catch(() => {});

      const keyboard = new InlineKeyboard()
        .text('🔙 К аккаунту', `persona_select:${personaId}`)
        .row()
        .text('🔙 Меню', 'menu');

      await ctx.reply(
        `✅ *Синхронизация завершена!*\n\n` +
          `• Импортировано контактов: *${count}*\n` +
          `• Загружено исторических сообщений: *${totalMessagesSynced}*\n\n` +
          `Все диалоги успешно добавлены в список лидов бота с полной историей переписки (до 100 последних сообщений на чат).`,
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    } catch (err) {
      this.logger.error(`Failed to sync dialogs: ${(err as Error).message}`);
      await ctx.reply(`❌ Ошибка синхронизации: ${(err as Error).message}`);
    }
  }
}
