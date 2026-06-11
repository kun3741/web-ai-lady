import { Injectable, Logger } from '@nestjs/common';
import { InlineKeyboard, InputFile } from 'grammy';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { ContentGroupService } from '@modules/content-group/content-group.service';
import { SettingsService } from '@modules/settings/settings.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';

@Injectable()
export class MediaPanel {
  private readonly logger = new Logger(MediaPanel.name);

  constructor(
    private readonly contentGroupService: ContentGroupService,
    private readonly settingsService: SettingsService,
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
  ) {}

  async render(ctx: BotContext, params: string[]): Promise<void> {
    const subAction = params[0] || 'list';

    const ws = await this.settingsService.getOrCreateDefault();
    const groupId = ws.contentGroupId || '2183482722';

    if (subAction === 'list') {
      const page = parseInt(params[1] || '1', 10);
      const filterCategory = params[2] || 'all';

      const dbQuery: any = {};
      if (filterCategory !== 'all') {
        dbQuery.category = filterCategory;
      }

      const totalItems = await this.contentGroupService.countMediaItems(groupId, dbQuery);
      const limit = 6; // Compact page size to fit keyboard limits beautifully
      const totalPages = Math.ceil(totalItems / limit) || 1;
      const currentPage = Math.max(1, Math.min(page, totalPages));
      const skip = (currentPage - 1) * limit;

      const items = await this.contentGroupService.findMediaItemsPaginated(
        groupId,
        dbQuery,
        skip,
        limit,
      );

      const keyboard = new InlineKeyboard();

      for (const item of items) {
        const typeEmoji =
          item.mediaType === 'photo'
            ? '📷'
            : item.mediaType === 'video'
              ? '🎥'
              : item.mediaType === 'voice'
                ? '🎤'
                : item.mediaType === 'video_note'
                  ? '⭕'
                  : '📄';

        const label = item.caption
          ? item.caption.substring(0, 18).replace(/\n/g, ' ')
          : item.filename || item.mediaType;

        keyboard
          .text(
            `${typeEmoji} [${item.category}] ${label}`,
            `media:view:${item._id}:${currentPage}:${filterCategory}`,
          )
          .row();
      }

      // Pagination row
      const navRow: any[] = [];
      if (currentPage > 1) {
        navRow.push({
          text: '◀️ Пред',
          callback_data: `media:list:${currentPage - 1}:${filterCategory}`,
        });
      }
      navRow.push({ text: `стр. ${currentPage}/${totalPages}`, callback_data: 'noop' });
      if (currentPage < totalPages) {
        navRow.push({
          text: 'След ▶️',
          callback_data: `media:list:${currentPage + 1}:${filterCategory}`,
        });
      }
      keyboard.row(...navRow);

      // Filter and main menu buttons
      keyboard
        .row()
        .text(
          `📂 Категория: ${filterCategory === 'all' ? 'Все' : filterCategory}`,
          `media:categories:${currentPage}`,
        )
        .row()
        .text('🔙 Меню', 'menu');

      const text =
        `🎬 *Медиа-библиотека (Всего: ${totalItems})*\n\n` +
        `*Группа:* \`${groupId}\`\n` +
        `*Фильтр:* \`${filterCategory === 'all' ? 'Все категории' : filterCategory}\`\n\n` +
        (totalItems === 0
          ? 'Медиа-ассеты не найдены. Выполните синхронизацию в панели контент-группы.'
          : 'Выберите ассет для просмотра и отправки:');

      try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
      } catch (_) {
        await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
      }
      return;
    }

    if (subAction === 'categories') {
      const returnPage = params[1] || '1';
      const activeCategories = await this.contentGroupService.getDistinctCategories(groupId);

      const keyboard = new InlineKeyboard().text('📁 Все категории', `media:list:1:all`).row();

      for (const cat of activeCategories) {
        keyboard.text(`📁 ${cat}`, `media:list:1:${cat}`).row();
      }

      keyboard.text('🔙 Назад', `media:list:${returnPage}:all`);

      const text = `📂 *Выберите категорию для фильтрации контента:*`;
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
      return;
    }

    if (subAction === 'view') {
      const mediaItemId = params[1];
      const currentPage = params[2] || '1';
      const filterCategory = params[3] || 'all';

      if (!mediaItemId || !Types.ObjectId.isValid(mediaItemId)) return;

      const item = await this.contentGroupService.getMediaItemById(mediaItemId);
      if (!item) {
        await ctx.reply('❌ Медиа-ассет не найден.');
        return;
      }

      const typeEmoji =
        item.mediaType === 'photo'
          ? '📷 Фото'
          : item.mediaType === 'video'
            ? '🎥 Видео'
            : item.mediaType === 'voice'
              ? '🎤 Голосовое'
              : item.mediaType === 'video_note'
                ? '⭕ Видео-кружок'
                : '📄 Документ';

      const keyboard = new InlineKeyboard()
        .text(
          '👁 Показать медиа в чате',
          `media:show:${mediaItemId}:${currentPage}:${filterCategory}`,
        )
        .row()
        .text('🔙 К списку', `media:list:${currentPage}:${filterCategory}`);

      const text =
        `${typeEmoji}\n\n` +
        `*Категория:* \`${item.category}\`\n` +
        `*Файл:* \`${item.filename || 'N/A'}\`\n` +
        `*MIME-тип:* \`${item.mimeType || 'N/A'}\`\n` +
        `*Message ID:* \`${item.messageId}\`\n` +
        `*Topic ID:* \`${item.topicId}\`\n\n` +
        `*Описание/Подпись:* \n_${item.caption || 'Нет подписи'}_`;

      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
      return;
    }

    if (subAction === 'show') {
      const mediaItemId = params[1];
      const currentPage = params[2] || '1';
      const filterCategory = params[3] || 'all';

      if (!mediaItemId || !Types.ObjectId.isValid(mediaItemId)) return;

      const item = await this.contentGroupService.getMediaItemById(mediaItemId);
      if (!item) return;

      // Find any connected persona for MTProto bridge
      const persona = await this.personaModel.findOne({ mtprotoConnected: true }).exec();
      if (!persona) {
        await ctx.answerCallbackQuery({
          text: '❌ Нет активного Bridge соединения! Подключите Telegram-аккаунт в Bridge.',
          show_alert: true,
        });
        return;
      }

      try {
        await ctx.answerCallbackQuery({ text: '⏳ Загрузка файла...' });

        const content = await this.contentGroupService.downloadMediaItem(
          item,
          persona._id.toString(),
        );
        if (!content || !content.buffer || content.buffer.length === 0) {
          throw new Error('Не удалось скачать файл');
        }

        const file = new InputFile(content.buffer, content.filename);
        const caption = item.caption ? `📝 ${item.caption}` : undefined;

        if (item.mediaType === 'photo') {
          await ctx.replyWithPhoto(file, { caption });
        } else if (item.mediaType === 'video') {
          await ctx.replyWithVideo(file, { caption });
        } else if (item.mediaType === 'voice') {
          await ctx.replyWithVoice(file, { caption });
        } else if (item.mediaType === 'video_note') {
          await ctx.replyWithVideoNote(file);
        } else {
          await ctx.replyWithDocument(file, { caption });
        }
      } catch (err: any) {
        this.logger.error(`Failed to show media item ${item.messageId}: ${err.message}`);
        await ctx.reply(`❌ Не удалось отправить файл: ${err.message}`);
      }

      // Re-render the view panel so the menu remains active
      await this.render(ctx, ['view', mediaItemId, currentPage, filterCategory]);
    }
  }
}
