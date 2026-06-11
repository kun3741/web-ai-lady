import { Injectable } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';
import { MtprotoBridgeService } from '@infrastructure/telegram/mtproto-bridge.service';

@Injectable()
export class PersonasPanel {
  constructor(
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
    private readonly bridge: MtprotoBridgeService,
  ) {}

  async render(ctx: BotContext, _params: string[]): Promise<void> {
    const personas = await this.personaModel.find().exec();

    const keyboard = new InlineKeyboard();
    for (const p of personas) {
      const statusEmoji = p.status === 'active' ? '🟢' : '⏸';
      keyboard.text(`${statusEmoji} ${p.name} (@${p.telegramAccountId})`, `persona_select:${p._id}`).row();
    }

    keyboard.text('➕ Новый аккаунт', 'personas:create')
      .text('📂 Контент-группа', 'content_group:menu')
      .row()
      .text('🔙 Назад', 'menu');

    const text =
      `👤 *Аккаунты (Персоны)*\n\n` +
      `Ниже представлены подключенные аккаунты. Выберите персону для детального управления:`;

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  async handleCreate(ctx: BotContext): Promise<void> {
    ctx.session.awaitingInput = 'create_persona_name';
    const keyboard = new InlineKeyboard().text('🔙 Отмена', 'personas');

    try {
      await ctx.editMessageText(
        '✏️ *Создание нового аккаунта*\n\n' +
          'Введите *имя* для аккаунта (например: "Марина", `Lady_Account_1`):',
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    } catch (_) {
      await ctx.reply(
        '✏️ *Создание нового аккаунта*\n\n' +
          'Введите *имя* для аккаунта (например: "Марина", `Lady_Account_1`):',
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    }
  }

  async handleSelect(ctx: BotContext, params: string[]): Promise<void> {
    const id = params[0];
    if (!id || !Types.ObjectId.isValid(id)) return;

    const persona = await this.personaModel.findById(id).exec();
    if (!persona) {
      await ctx.reply('❌ Персона не найдена.');
      return;
    }

    // Handle toggle action if provided in params
    if (params[1] === 'toggle_status') {
      const newStatus = persona.status === 'active' ? 'paused' : 'active';
      persona.status = newStatus;
      await persona.save();
      await ctx.answerCallbackQuery(`Статус изменен на: ${newStatus}`);
    }

    const keyboard = new InlineKeyboard()
      .text('👨 Лиды этого аккаунта', `leads:list:1:${persona._id}`)
      .row()
      .text('📝 Био', `personas:edit:biography:${persona._id}`)
      .text('📞 Тел', `personas:edit:phone:${persona._id}`)
      .text('💬 WA', `personas:edit:whatsapp:${persona._id}`)
      .row()
      .text('💳 Реквизиты', `personas:edit:payment:${persona._id}`)
      .text('📁 Папка (тег)', `personas:edit:media:${persona._id}`)
      .row()
      .text('📖 Легенда', `personas:edit:legend:${persona._id}`)
      .text('💰 Правила оплат', `personas:edit:paymentrules:${persona._id}`)
      .row()
      .text(
        persona.status === 'active' ? '⏸ Поставить на паузу' : '▶️ Активировать',
        `persona_select:${persona._id}:toggle_status`,
      )
      .row()
      .text(
        this.bridge.isConnected(id) ? '🟢 Bridge' : '🔴 Bridge',
        `bridge:menu:${persona._id}`,
      )
      .row()
      .text('🔙 К списку', 'personas');

    const quietHoursStr = persona.quietHours
      ? `${persona.quietHours.start} - ${persona.quietHours.end} (${persona.quietHours.timezone})`
      : 'Не настроено';

    const text =
      `👤 *Персона: ${persona.name}*\n\n` +
      `*Telegram ID:* \`@${persona.telegramAccountId}\`\n` +
      `*Статус:* ${persona.status === 'active' ? '🟢 Активен' : '⏸ На паузе'}\n` +
      `*Quiet Hours:* ${quietHoursStr}\n\n` +
      `ℹ️ *Персональные данные девушки (модели):*\n` +
      `• *Биография:* ${persona.biography || '_Не заполнена_'}\n` +
      `• *Телефон:* \`${persona.phone || 'Не указан'}\`\n` +
      `• *WhatsApp:* \`${persona.whatsApp || 'Не указан'}\`\n` +
      `• *Реквизиты:* \`${persona.paymentDetails || 'Не указаны'}\`\n` +
      `• *Папка контента (тег):* \`${persona.mediaLibraryTag || 'Не указан'}\`\n` +
      `• *Легенда:* ${persona.legend ? `_${persona.legend.substring(0, 80)}..._` : '_Не заполнена_'}\n` +
      `• *Правила оплат:* ${persona.paymentRules ? '✅ Заполнены' : '_Не заполнены_'}\n\n` +
      `🔗 *Bridge:* ${this.bridge.isConnected(id) ? '🟢 Подключен' : '🔴 Не подключен'}\n\n` +
      `💡 Выберите кнопку ниже для редактирования параметров.`;

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  /**
   * Render prompt asking user for field update
   */
  async handleEdit(ctx: BotContext, params: string[]): Promise<void> {
    const field = params[0]; // biography, phone, whatsapp, payment, media
    const id = params[1];

    if (!id || !Types.ObjectId.isValid(id)) return;
    const persona = await this.personaModel.findById(id).exec();
    if (!persona) return;

    ctx.session.selectedPersonaId = id;

    let promptText = '';
    if (field === 'biography') {
      ctx.session.awaitingInput = 'edit_persona_biography';
      promptText = `✏️ *Редактирование биографии персоны ${persona.name}*\n\nВведите новое описание/биографию девушки (возраст, характер, хобби, легенда):`;
    } else if (field === 'phone') {
      ctx.session.awaitingInput = 'edit_persona_phone';
      promptText = `📞 *Редактирование номера телефона персоны ${persona.name}*\n\nВведите новый номер телефона для связи:`;
    } else if (field === 'whatsapp') {
      ctx.session.awaitingInput = 'edit_persona_whatsapp';
      promptText = `💬 *Редактирование WhatsApp персоны ${persona.name}*\n\nВведите WhatsApp (ссылку или номер телефона):`;
    } else if (field === 'payment') {
      ctx.session.awaitingInput = 'edit_persona_payment';
      promptText = `💳 *Редактирование платежных реквизитов персоны ${persona.name}*\n\nВведите новые реквизиты для оплат (номер карты, банка и т.д.):`;
    } else if (field === 'media') {
      ctx.session.awaitingInput = 'edit_persona_media';
      promptText = `📁 *Редактирование папки контента (тега) для ${persona.name}*\n\nВведите название папки/тега в медиа-библиотеке для контента этой девушки:`;
    } else if (field === 'legend') {
      ctx.session.awaitingInput = 'edit_persona_legend';
      promptText = `📖 *Редактирование легенды для ${persona.name}*\n\nВведите полную легенду персоны (кто она, характер, хобби, путешествия, семья, работа и т.д.).\n\n_Можно отправить длинный текст — он будет сохранен целиком._`;
    } else if (field === 'paymentrules') {
      ctx.session.awaitingInput = 'edit_persona_payment_rules';
      promptText = `💰 *Редактирование правил оплат для ${persona.name}*\n\nВведите правила оплат для разных стран (Турция, Египет, Индия и т.д.):`;
    }

    const keyboard = new InlineKeyboard().text('🔙 Отмена', `persona_select:${persona._id}`);

    await ctx.editMessageText(promptText, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}
