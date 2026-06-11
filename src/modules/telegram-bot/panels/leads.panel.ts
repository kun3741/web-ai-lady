import { Injectable } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Candidate } from '@modules/contacts/schemas/candidate.schema';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';

@Injectable()
export class LeadsPanel {
  constructor(
    @InjectModel(Candidate.name) private readonly candidateModel: Model<Candidate>,
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
  ) { }

  async render(ctx: BotContext, params: string[]): Promise<void> {
    const pageStr = params[1] || '1';
    const personaIdStr = params[2];

    const page = parseInt(pageStr, 10) || 1;
    const limit = 8;
    const skip = (page - 1) * limit;

    const query: any = {};
    if (personaIdStr && Types.ObjectId.isValid(personaIdStr)) {
      query.personaId = new Types.ObjectId(personaIdStr);
    }

    const [leads, total] = await Promise.all([
      this.candidateModel.find(query).sort({ lastMessageAt: -1 }).skip(skip).limit(limit).exec(),
      this.candidateModel.countDocuments(query).exec(),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    const keyboard = new InlineKeyboard();

    // List leads as buttons
    for (const lead of leads) {
      const lastMsgDate = lead.lastMessageAt
        ? new Date(lead.lastMessageAt).toLocaleDateString()
        : 'N/A';
      const statusEmoji =
        lead.status === 'active'
          ? '🟢'
          : lead.status === 'paused'
            ? '⏸'
            : lead.status === 'blocked'
              ? '🚫'
              : '📁';
      keyboard
        .text(
          `${statusEmoji} ${lead.displayName || 'Unknown'} [${lastMsgDate}]`,
          `lead:${lead._id}`,
        )
        .row();
    }

    // Pagination row
    if (page > 1) {
      keyboard.text('◀️ Пред.', `leads:list:${page - 1}${personaIdStr ? `:${personaIdStr}` : ''}`);
    }
    keyboard.text(`${page} / ${totalPages}`, 'noop');
    if (page < totalPages) {
      keyboard.text('След. ▶️', `leads:list:${page + 1}${personaIdStr ? `:${personaIdStr}` : ''}`);
    }
    keyboard.row();

    keyboard.text('➕ Новый лид', 'leads:create').text('🔙 Меню', 'menu');

    let text = `👨 *Список лидов (Всего: ${total})*\n\n`;
    if (leads.length === 0) {
      text += `Лиды не найдены.`;
    } else {
      text += `Выберите лида для просмотра деталей:`;
    }

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  /**
   * Start the lead creation flow: show persona selection
   */
  async handleCreate(ctx: BotContext): Promise<void> {
    const personas = await this.personaModel.find({ status: 'active' }).exec();

    if (personas.length === 0) {
      const keyboard = new InlineKeyboard()
        .text('➕ Создать аккаунт', 'personas:create')
        .row()
        .text('🔙 Назад', 'leads:list:1');

      await ctx.editMessageText(
        '⚠️ *Нет активных аккаунтов*\n\n' +
        'Для создания лида сначала необходимо создать аккаунт (персону).',
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
      return;
    }

    // If only one persona — auto-select it
    if (personas.length === 1) {
      await this.startLeadNameInput(ctx, personas[0]._id.toString());
      return;
    }

    // Multiple personas — show selection
    const keyboard = new InlineKeyboard();
    for (const p of personas) {
      keyboard.text(`${p.name} (@${p.telegramAccountId})`, `leads:select_persona:${p._id}`).row();
    }
    keyboard.text('🔙 Назад', 'leads:list:1');

    await ctx.editMessageText(
      '👤 *Выберите аккаунт для нового лида:*\n\n' + 'К какому аккаунту будет привязан кандидат?',
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  }

  /**
   * User selected a persona — ask for lead name via text input
   */
  async handleSelectPersona(ctx: BotContext, params: string[]): Promise<void> {
    const personaId = params[0];
    if (!personaId || !Types.ObjectId.isValid(personaId)) return;
    await this.startLeadNameInput(ctx, personaId);
  }

  private async startLeadNameInput(ctx: BotContext, personaId: string): Promise<void> {
    ctx.session.selectedPersonaId = personaId;
    ctx.session.awaitingInput = 'create_lead_name';

    const keyboard = new InlineKeyboard().text('🔙 Отмена', `leads:list:1:${personaId}`);

    try {
      await ctx.editMessageText(
        '✏️ *Создание нового лида*\n\n' + 'Введите *имя* кандидата (отобразится в списке лидов):',
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    } catch (_) {
      await ctx.reply(
        '✏️ *Создание нового лида*\n\n' + 'Введите *имя* кандидата (отобразится в списке лидов):',
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    }
  }
}
