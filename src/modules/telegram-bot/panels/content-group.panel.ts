import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InlineKeyboard } from 'grammy';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { ContentGroupService } from '@modules/content-group/content-group.service';
import { SettingsService } from '@modules/settings/settings.service';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';

@Injectable()
export class ContentGroupPanel {
  private readonly logger = new Logger(ContentGroupPanel.name);

  constructor(
    private readonly contentGroupService: ContentGroupService,
    private readonly settingsService: SettingsService,
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
  ) {}

  async handleAction(ctx: BotContext, params: string[]): Promise<void> {
    const action = params[0] || 'menu';

    if (action === 'menu') {
      await this.render(ctx);
    } else if (action === 'sync') {
      await this.handleSync(ctx);
    } else if (action === 'topics') {
      const page = parseInt(params[1] || '1', 10);
      await this.renderTopics(ctx, page);
    } else if (action === 'toggle') {
      const topicId = parseInt(params[1], 10);
      const page = parseInt(params[2] || '1', 10);
      await this.handleToggle(ctx, topicId, page);
    } else if (action === 'edit_id') {
      await this.promptEditGroupId(ctx);
    }
  }

  async render(ctx: BotContext): Promise<void> {
    const ws = await this.settingsService.getOrCreateDefault();
    const groupId = ws.contentGroupId || '2183482722';
    const config = await this.contentGroupService.getOrCreateConfig(groupId);
    
    const totalTopics = config.topicMappings?.length || 0;
    const enabledTopics = config.topicMappings?.filter(t => t.enabled).length || 0;
    const lastSync = config.lastSyncedAt 
      ? config.lastSyncedAt.toLocaleString('ru-RU', { timeZone: 'Europe/Kiev' })
      : 'Ни разу';

    const keyboard = new InlineKeyboard()
      .text('🔄 Синхронизировать', 'content_group:sync')
      .text('⚙️ Список топиков', 'content_group:topics:1')
      .row()
      .text('✏️ Изменить ID группы', 'content_group:edit_id')
      .row()
      .text('🔙 К аккаунтам', 'personas');

    const text =
      `📂 *Управление контент-группой*\n\n` +
      `*ID группы:* \`${groupId}\`\n` +
      `*Всего топиков в базе:* \`${totalTopics}\`\n` +
      `*Активных топиков:* \`${enabledTopics}\`\n` +
      `*Последняя синхронизация:* \`${lastSync}\`\n\n` +
      `💡 _Контент-группа используется для извлечения фото/видео контента и отправки лидам на различных этапах воронки._`;

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  async handleSync(ctx: BotContext): Promise<void> {
    // Find any persona with active MTProto connection
    const persona = await this.personaModel.findOne({ mtprotoConnected: true }).exec();
    if (!persona) {
      await ctx.answerCallbackQuery({
        text: '❌ Нет активного Bridge соединения! Подключите Telegram-аккаунт в разделе Bridge.',
        show_alert: true,
      });
      return;
    }

    const ws = await this.settingsService.getOrCreateDefault();
    const groupId = ws.contentGroupId || '2183482722';

    try {
      await ctx.editMessageText('⏳ *Синхронизация топиков...*\nПожалуйста, подождите.', { parse_mode: 'Markdown' });
      
      const result = await this.contentGroupService.syncTopics(groupId, persona._id.toString());
      
      await ctx.answerCallbackQuery({
        text: `✅ Синхронизация успешна! Добавлено/обновлено топиков: ${result.synced}, исключено: ${result.excluded}`,
        show_alert: true,
      });
    } catch (err: any) {
      this.logger.error(`Failed to sync content group: ${err.message}`, err.stack);
      await ctx.answerCallbackQuery({
        text: `❌ Ошибка синхронизации: ${err.message}`,
        show_alert: true,
      });
    }

    await this.render(ctx);
  }

  async renderTopics(ctx: BotContext, page: number): Promise<void> {
    const ws = await this.settingsService.getOrCreateDefault();
    const groupId = ws.contentGroupId || '2183482722';
    const config = await this.contentGroupService.getOrCreateConfig(groupId);
    const topics = config.topicMappings || [];

    if (topics.length === 0) {
      const keyboard = new InlineKeyboard()
        .text('🔄 Синхронизировать сейчас', 'content_group:sync')
        .row()
        .text('🔙 Назад', 'content_group:menu');
      
      await ctx.editMessageText(
        '⚠️ *Список топиков пуст.*\n\nСначала выполните синхронизацию топиков из группы Telegram.',
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );
      return;
    }

    const limit = 5;
    const totalPages = Math.ceil(topics.length / limit);
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (currentPage - 1) * limit;
    const pageTopics = topics.slice(startIndex, startIndex + limit);

    const keyboard = new InlineKeyboard();

    for (const t of pageTopics) {
      const statusEmoji = t.enabled ? '🟢' : '🔴';
      const matureSuffix = t.mature ? ' 🔞' : '';
      keyboard.text(
        `${statusEmoji} ${t.topicTitle} [${t.category}]${matureSuffix}`,
        `content_group:toggle:${t.topicId}:${currentPage}`
      ).row();
    }

    // Pagination row
    const navRow: any[] = [];
    if (currentPage > 1) {
      navRow.push({ text: '◀️ Пред', callback_data: `content_group:topics:${currentPage - 1}` });
    }
    navRow.push({ text: `стр. ${currentPage}/${totalPages}`, callback_data: 'noop' });
    if (currentPage < totalPages) {
      navRow.push({ text: 'След ▶️', callback_data: `content_group:topics:${currentPage + 1}` });
    }
    keyboard.row(...navRow);

    keyboard.row().text('🔙 Назад', 'content_group:menu');

    const text =
      `⚙️ *Настройка топиков группы*\n\n` +
      `Нажмите на топик, чтобы включить/выключить его:\n` +
      `🟢 — топик включен (контент отправляется)\n` +
      `🔴 — топик выключен (контент игнорируется)\n` +
      `🔞 — откровенный контент (playful / mature)`;

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  async handleToggle(ctx: BotContext, topicId: number, page: number): Promise<void> {
    const ws = await this.settingsService.getOrCreateDefault();
    const groupId = ws.contentGroupId || '2183482722';
    const config = await this.contentGroupService.getOrCreateConfig(groupId);
    const topic = config.topicMappings.find(t => t.topicId === topicId);

    if (topic) {
      const newStatus = !topic.enabled;
      await this.contentGroupService.setTopicEnabled(groupId, topicId, newStatus);
      await ctx.answerCallbackQuery(`Топик "${topic.topicTitle}" теперь ${newStatus ? 'включен' : 'выключен'}`);
    } else {
      await ctx.answerCallbackQuery('Топик не найден.');
    }

    await this.renderTopics(ctx, page);
  }

  async promptEditGroupId(ctx: BotContext): Promise<void> {
    ctx.session.awaitingInput = 'edit_content_group_id';
    const keyboard = new InlineKeyboard().text('🔙 Отмена', 'content_group:menu');
    await ctx.editMessageText(
      '✏️ *Изменение ID контент-группы*\n\n' +
      'Введите новый ID Telegram супергруппы (числовой ID, например `2183482722`):',
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  }

  async handleEditGroupIdInput(ctx: BotContext, text: string): Promise<void> {
    const cleanId = text.trim();
    if (!/^-?\d+$/.test(cleanId)) {
      await ctx.reply('❌ Некорректный ID группы. Должно быть число. Попробуйте еще раз:');
      return;
    }

    try {
      await this.settingsService.updateContentGroupId(cleanId);
      ctx.session.awaitingInput = undefined;

      const keyboard = new InlineKeyboard().text('📂 Открыть панель контент-группы', 'content_group:menu');
      await ctx.reply(
        `✅ *ID контент-группы успешно обновлен!*\n\n` +
        `Новый ID: \`${cleanId}\``,
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );
    } catch (err: any) {
      this.logger.error(`Failed to update content group ID: ${err.message}`);
      ctx.session.awaitingInput = undefined;
      await ctx.reply(`❌ Ошибка обновления ID: ${err.message}`);
    }
  }
}
