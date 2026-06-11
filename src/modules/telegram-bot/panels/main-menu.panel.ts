import { Injectable } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { SettingsService } from '@modules/settings/settings.service';
import { AnalyticsService } from '@modules/analytics/analytics.service';

@Injectable()
export class MainMenuPanel {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  async render(ctx: BotContext): Promise<void> {
    const keyboard = this.buildMainKeyboard();
    const text =
      `✨ *Virtual Lady Assistant - Главное меню* ✨\n\n` +
      `Все обычное управление вынесено в inline-кнопки. ` +
      `Команды оставлены только для входа и аварийных действий.`;

    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  }

  async renderSettings(ctx: BotContext): Promise<void> {
    const ws = await this.settingsService.getOrCreateDefault();
    const pauseStatus = ws.globalPaused ? '⏸ Пауза активна' : '🟢 Работает';

    const keyboard = new InlineKeyboard()
      .text(
        ws.globalPaused ? '▶️ Снять паузу' : '⏸ Поставить на паузу',
        `auto:global:${ws.globalPaused ? 'resume' : 'pause'}`,
      )
      .row()
      .text('🗑 Полная очистка базы', 'clear_all:prompt')
      .row()
      .text('🔙 Назад', 'menu');

    const text =
      `⚙️ *Настройки системы*\n\n` +
      `*Статус:* ${pauseStatus}\n` +
      `*Администраторы:* \`${ws.adminTelegramIds.join(', ') || 'не заданы'}\`\n\n` +
      `Для ежедневной работы используйте кнопки меню.\n` +
      `🚨 Аварийные команды: /panic и /clear\\_all.`;

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  async renderAnalytics(ctx: BotContext): Promise<void> {
    const stats = await this.analyticsService.getOverviewStats();
    const daily = await this.analyticsService.getDailySummary();

    const keyboard = new InlineKeyboard()
      .text('🔄 Обновить', 'menu:analytics')
      .row()
      .text('🔙 Назад', 'menu');

    const text =
      `📊 *Статистика системы*\n\n` +
      `*Всего контактов:* ${stats.leads.total}\n` +
      `👤 Активные: ${stats.leads.active} | ⏸ Пауза: ${stats.leads.paused} | 📁 Архив: ${stats.leads.archived} | 🚫 Блок: ${stats.leads.blocked}\n\n` +
      `*Сообщения:* 📥 входящие ${stats.messages.inbound} | 📤 исходящие ${stats.messages.outbound}\n` +
      `*Черновики в очереди:* 📝 ${stats.messages.drafts}\n\n` +
      `📅 *Сегодня:*\n` +
      `• Новых лидов: ${daily.newLeads}\n` +
      `• Входящих: ${daily.messagesToday.inbound} | Исходящих: ${daily.messagesToday.outbound}\n` +
      `• Среднее время ответа: ⏱ ${daily.avgLatencyMinutes} мин.`;

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  async renderHelp(ctx: BotContext): Promise<void> {
    const keyboard = new InlineKeyboard()
      .text('👥 Лиды', 'leads:list:1')
      .text('🎭 Аккаунты', 'personas:list')
      .row()
      .text('📝 Черновики', 'drafts:list')
      .text('📥 Импорт', 'import:menu')
      .row()
      .text('🔙 Назад', 'menu');

    const text =
      `❓ *Справка*\n\n` +
      `Обычная работа выполняется через кнопки:\n` +
      `🎭 *Аккаунты:* профили девушек, персональные данные, реквизиты и папка контента.\n` +
      `👥 *Лиды:* кандидаты, статусы, этапы воронки и режим автоматизации.\n` +
      `📝 *Черновики:* генерация, проверка, переписывание и утверждение ответов.\n` +
      `📥 *Импорт:* загрузка Telegram JSON для истории и извлечения примеров стиля.\n` +
      `📸 *Медиа:* библиотека фото, видео и голосовых по профилям.\n\n` +
      `Команды оставлены только для быстрого входа и аварийных действий:\n` +
      `/start - открыть меню\n` +
      `/panic - срочно поставить автопилот на паузу\n` +
      `/clear\\_all - полная очистка базы с подтверждением`;

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  private buildMainKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
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
  }
}
