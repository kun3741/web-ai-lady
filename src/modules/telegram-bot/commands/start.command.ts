import { Injectable } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { SettingsService } from '@modules/settings/settings.service';

@Injectable()
export class StartCommand {
  constructor(private readonly settingsService: SettingsService) {}

  async handle(ctx: BotContext): Promise<void> {
    const userId = ctx.from?.id?.toString();
    if (!userId) return;

    const ws = await this.settingsService.getOrCreateDefault();
    if (!ws.adminTelegramIds.includes(userId)) {
      await this.settingsService.addAdmin(userId);
    }

    const keyboard = new InlineKeyboard()
      .text('👥 Лиды', 'leads:list:1')
      .text('🎭 Аккаунты', 'personas:list')
      .row()
      .text('📝 Черновики', 'drafts:list')
      .text('📸 Медиа', 'media:list')
      .row()
      .text('📊 Статистика', 'menu:analytics')
      .text('📥 Импорт', 'import:menu')
      .row()
      .text('❓ Справка', 'menu:help')
      .text('⚙️ Настройки', 'menu:settings');

    await ctx.reply(
      `✨ *Virtual Lady Assistant* ✨\n\n` +
        `Привет! Я копилот для управления перепиской.\n\n` +
        `Используйте кнопки ниже для навигации и обычной работы.\n` +
        `🚨 Аварийные команды: /panic, /clear\\_all`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  }
}
