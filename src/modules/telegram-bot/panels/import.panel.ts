import { Injectable } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ImportJob } from '@modules/imports/schemas/import-job.schema';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';
import { SettingsService } from '@modules/settings/settings.service';

@Injectable()
export class ImportPanel {
  constructor(
    @InjectModel(ImportJob.name) private readonly importJobModel: Model<ImportJob>,
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
    private readonly settingsService: SettingsService,
  ) {}

  async handleAction(ctx: BotContext, params: string[]): Promise<void> {
    const action = params[0] || 'menu';

    if (action === 'menu') {
      await this.render(ctx);
    } else if (action === 'upload') {
      await this.renderPersonaSelection(ctx);
    } else if (action === 'select_persona') {
      const personaId = params[1];
      if (personaId && Types.ObjectId.isValid(personaId)) {
        await this.handleSelectPersona(ctx, personaId);
      }
    }
  }

  /** Show persona selection for import target */
  private async renderPersonaSelection(ctx: BotContext): Promise<void> {
    const personas = await this.personaModel.find({ status: 'active' }).exec();

    if (personas.length === 0) {
      await ctx.editMessageText(
        '❌ *Нет активных аккаунтов*\n\nСначала создайте аккаунт (персону) в разделе «Аккаунты».',
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('🔙 Назад', 'import:menu'),
        },
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const p of personas) {
      keyboard.text(`👤 ${p.name}`, `import:select_persona:${p._id}`).row();
    }
    keyboard.text('🔙 Назад', 'import:menu');

    await ctx.editMessageText(
      `📥 *Загрузка JSON-чата*\n\nВыберите аккаунт (персону), в который будет импортирован чат:`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  }

  /** Set session to await file upload for chosen persona */
  private async handleSelectPersona(ctx: BotContext, personaId: string): Promise<void> {
    const persona = await this.personaModel.findById(personaId).exec();
    if (!persona) {
      await ctx.editMessageText('❌ Персона не найдена.', {
        reply_markup: new InlineKeyboard().text('🔙 Назад', 'import:menu'),
      });
      return;
    }

    ctx.session.awaitingInput = 'import_file';
    ctx.session.awaitingImportPersonaId = personaId;

    const keyboard = new InlineKeyboard().text('❌ Отмена', 'import:menu');
    await ctx.editMessageText(
      `📥 *Импорт для: ${persona.name}*\n\n` +
        `Отправьте JSON-файл экспорта чата в этот чат.\n\n` +
        `💡 _Как получить файл:_\n` +
        `1. Telegram Desktop → Откройте нужный чат\n` +
        `2. ⋮ → Export Chat History → Format: JSON\n` +
        `3. Отправьте полученный \`.json\` файл сюда`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  }

  async render(ctx: BotContext): Promise<void> {
    const ws = await this.settingsService.getOrCreateDefault();
    const recent = await this.importJobModel
      .find({ workspaceId: ws._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .exec();

    const keyboard = new InlineKeyboard()
      .text('📥 Загрузить JSON', 'import:upload')
      .row()
      .text('🔄 Обновить', 'import:menu')
      .row()
      .text('🔙 Назад', 'menu');

    let text = `📥 *Импорт истории чатов*\n\n` + `*Последние задачи импорта:*\n`;

    if (recent.length === 0) {
      text += `Нет недавних задач импорта.\n`;
    } else {
      for (const job of recent) {
        const statusText =
          job.status === 'completed'
            ? 'Завершено'
            : job.status === 'processing'
              ? 'В обработке'
              : job.status === 'failed'
                ? 'Ошибка'
                : 'Ожидает';
        const statusEmoji =
          job.status === 'completed'
            ? '✅'
            : job.status === 'processing'
              ? '⏳'
              : job.status === 'failed'
                ? '❌'
                : '⏳';
        const statsStr =
          job.status === 'completed'
            ? `(Импортировано: ${job.stats?.imported || 0} сообщений)`
            : '';
        text += `${statusEmoji} *${job.fileName}* — ${statusText} ${statsStr}\n`;
      }
    }

    text += `\n💡 _Нажмите «📥 Загрузить JSON» для импорта нового чата._`;

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}
