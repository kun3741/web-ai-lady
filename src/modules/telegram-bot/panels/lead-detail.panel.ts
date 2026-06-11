import { Injectable, Logger } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { ContactsService } from '@modules/contacts/contacts.service';
import { MessagesService } from '@modules/messages/messages.service';
import { FunnelService } from '@modules/funnel/funnel.service';
import { AutomationService } from '@modules/automation/automation.service';
import { SettingsService } from '@modules/settings/settings.service';
import { FunnelStage, FUNNEL_STAGES } from '@modules/funnel/schemas/funnel-stage-state.schema';
import { Types } from 'mongoose';

@Injectable()
export class LeadDetailPanel {
  private readonly logger = new Logger(LeadDetailPanel.name);

  constructor(
    private readonly contactsService: ContactsService,
    private readonly messagesService: MessagesService,
    private readonly funnelService: FunnelService,
    private readonly automationService: AutomationService,
    private readonly settingsService: SettingsService,
  ) {}

  async render(ctx: BotContext, params: string[]): Promise<void> {
    const candidateId = params[0];
    if (!candidateId || !Types.ObjectId.isValid(candidateId)) return;

    const candidate = await this.contactsService.findById(candidateId);
    if (!candidate) {
      await ctx.reply('❌ Лид не найден.');
      return;
    }

    const funnelState = await this.funnelService.getOrCreate(candidateId, candidate.personaId.toString());
    const ws = await this.settingsService.getOrCreateDefault();
    const policy = await this.automationService.getPolicyForCandidate(
      candidateId,
      candidate.personaId.toString(),
      ws._id.toString(),
    );

    const lastMsg = await this.messagesService.getLastInboundMessage(candidate.personaId.toString(), candidateId);
    const lastMsgStr = lastMsg 
      ? `_${lastMsg.normalizedText.substring(0, 100)}${lastMsg.normalizedText.length > 100 ? '...' : ''}_` 
      : 'Нет входящих сообщений';

    const statusEmoji = candidate.status === 'active' ? '🟢' : candidate.status === 'paused' ? '⏸' : candidate.status === 'blocked' ? '🚫' : '📁';
    const statusText = candidate.status === 'active' ? 'АКТИВНЫЙ' : candidate.status === 'paused' ? 'НА ПАУЗЕ' : candidate.status === 'blocked' ? 'ЗАБЛОКИРОВАН' : 'В АРХИВЕ';
    const modeText = policy.mode === 'draft' ? 'Только черновик' : policy.mode === 'assisted' ? 'Ассистент' : policy.mode === 'full' ? 'Полный автопилот' : 'На паузе';

    const keyboard = new InlineKeyboard()
      .text(
        candidate.status === 'active' ? '⏸ Пауза' : '▶️ Снять паузу',
        `lead_status:${candidateId}:${candidate.status === 'active' ? 'paused' : 'active'}`,
      )
      .text('📁 В архив', `lead_status:${candidateId}:archived`)
      .text('🚫 Блок', `lead_status:${candidateId}:blocked`)
      .row()
      .text(`🎯 Воронка: ${funnelState.stage}`, `funnel:${candidateId}:menu`)
      .row()
      .text(`⚙️ Авто: ${modeText}`, `auto:${candidateId}:menu`)
      .row()
      .text('💬 Написать вручную', `manual_reply:start:${candidateId}`)
      .text('📥 Инфо пересылки', `manual_reply:forward_help:${candidateId}`)
      .row()
      .text('📝 Создать черновик', `generate:${candidateId}`)
      .text('📸 Отправить контент', `content_send:menu:${candidateId}`)
      .row()
      .text('🔙 Назад к списку', `leads:list:1:${candidate.personaId}`);

    const text =
      `👨 *Лид: ${candidate.displayName}*\n\n` +
      `*Статус:* ${statusEmoji} ${statusText}\n` +
      `*Возраст:* ${candidate.profile?.age || 'Не указан'}\n` +
      `*Локация:* ${candidate.profile?.location || 'Не указана'}\n` +
      `*Профессия:* ${candidate.profile?.occupation || 'Не указана'}\n` +
      `*Теги:* ${candidate.tags.length > 0 ? candidate.tags.join(', ') : 'Нет тегов'}\n\n` +
      `*Последнее сообщение:* ${lastMsgStr}\n\n` +
      `*Этап воронки:* \`${funnelState.stage}\`\n` +
      `*Цель этапа:* _${funnelState.objective || 'Нет цели'}_\n\n` +
      `*Режим автоматизации:* \`${modeText}\`\n` +
      `*Медиа-запрет:* ${policy.neverAutosendMedia ? '⛔ Запрещен авто-сенд' : '✅ Разрешен'}`;

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  async handleManualReplyAction(ctx: BotContext, params: string[]): Promise<void> {
    const action = params[0];
    const candidateId = params[1];

    if (!candidateId || !Types.ObjectId.isValid(candidateId)) return;

    const candidate = await this.contactsService.findById(candidateId);
    if (!candidate) return;

    if (action === 'start') {
      ctx.session.awaitingInput = 'manual_reply';
      ctx.session.activeCandidateId = candidateId;

      const keyboard = new InlineKeyboard().text('❌ Отмена', `lead:${candidateId}`);
      await ctx.editMessageText(
        `💬 *Ручной ответ для: ${candidate.displayName}*\n\n` +
        `Введите сообщение, которое хотите отправить кандидату.\n\n` +
        `💡 _Если подключен Bridge, оно будет отправлено автоматически. Если нет, оно сохранится как одобренное сообщение для копирования._`,
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    } else if (action === 'forward_help') {
      const keyboard = new InlineKeyboard().text('🔙 Назад', `lead:${candidateId}`);
      await ctx.editMessageText(
        `📥 *Как переслать сообщение от кандидата:*\n\n` +
        `1. В Telegram откройте диалог с кандидатом.\n` +
        `2. Выберите сообщение кандидата.\n` +
        `3. Нажмите «Переслать» (Forward) и выберите этого бота.\n\n` +
        `💡 _Бот запишет сообщение как входящее, автоматически обновит память и сгенерирует черновик ответа!_`,
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    }
  }

  async handleStatus(ctx: BotContext, params: string[]): Promise<void> {
    const candidateId = params[0];
    const newStatus = params[1];
    if (!candidateId || !newStatus) return;

    const ws = await this.settingsService.getOrCreateDefault();
    await this.contactsService.setStatus(candidateId, newStatus, ws._id.toString());
    await ctx.answerCallbackQuery(`Статус изменен на: ${newStatus}`);
    await this.render(ctx, [candidateId]);
  }

  async handleFunnel(ctx: BotContext, params: string[]): Promise<void> {
    const candidateId = params[0];
    const action = params[1] || 'menu';

    if (!candidateId || !Types.ObjectId.isValid(candidateId)) return;

    const candidate = await this.contactsService.findById(candidateId);
    if (!candidate) return;

    if (action === 'menu') {
      const keyboard = new InlineKeyboard();
      let count = 0;
      for (const stage of FUNNEL_STAGES) {
        keyboard.text(stage, `funnel:${candidateId}:set:${stage}`);
        count++;
        if (count % 3 === 0) keyboard.row();
      }
      keyboard.row().text('🔙 Назад', `lead:${candidateId}`);

      const text = `🎯 *Изменить этап воронки для ${candidate.displayName}*\n\nВыберите новый этап воронки из списка ниже:`;
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
      return;
    }

    if (action === 'set') {
      const newStage = params[2] as FunnelStage;
      const ws = await this.settingsService.getOrCreateDefault();
      await this.funnelService.transition(
        candidateId,
        newStage,
        'Changed manually by admin via bot interface',
        'admin',
        ws._id.toString(),
      );
      await ctx.answerCallbackQuery(`Этап воронки изменен на: ${newStage}`);
      await this.render(ctx, [candidateId]);
    }
  }

  async handleAutomation(ctx: BotContext, params: string[]): Promise<void> {
    const candidateId = params[0];
    const action = params[1] || 'menu';

    if (!candidateId || !Types.ObjectId.isValid(candidateId)) return;

    const candidate = await this.contactsService.findById(candidateId);
    if (!candidate) return;

    if (action === 'global') {
      const mode = params[2];
      const paused = mode === 'pause';
      await this.settingsService.setGlobalPause(paused);
      await ctx.answerCallbackQuery(paused ? 'Глобальная пауза активирована' : 'Глобальная пауза снята');
      
      const ws = await this.settingsService.getOrCreateDefault();
      const keyboard = new InlineKeyboard()
        .text(
          ws.globalPaused ? '▶️ Снять паузу' : '⏸ Поставить на паузу',
          `auto:global:${ws.globalPaused ? 'resume' : 'pause'}`,
        )
        .row()
        .text('🔙 Назад', 'menu');
      const text =
        `⚙️ *Настройки Системы*\n\n` +
        `*Статус:* ${ws.globalPaused ? '⏸ Пауза (Активна)' : '▶️ Работает'}\n` +
        `*Администраторы:* \`${ws.adminTelegramIds.join(', ')}\``;
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
      return;
    }

    if (action === 'menu') {
      const ws = await this.settingsService.getOrCreateDefault();
      const policy = await this.automationService.getPolicyForCandidate(
        candidateId,
        candidate.personaId.toString(),
        ws._id.toString(),
      );

      const modeText = policy.mode === 'draft' ? 'Только черновик' : policy.mode === 'assisted' ? 'Ассистент' : policy.mode === 'full' ? 'Полный автопилот' : 'На паузе';
      const mediaToggleText = policy.neverAutosendMedia
        ? '✅ Разрешить авто-отправку медиа'
        : '⛔ Запретить авто-отправку медиа';

      const keyboard = new InlineKeyboard()
        .text('📝 Только черновик (Draft)', `auto:${candidateId}:set:draft`)
        .row()
        .text('🤝 Ассистент (Assisted)', `auto:${candidateId}:set:assisted`)
        .row()
        .text('🚀 Полный автопилот (Full)', `auto:${candidateId}:set:full`)
        .row()
        .text('⏸ На паузе (Paused)', `auto:${candidateId}:set:paused`)
        .row()
        .text(mediaToggleText, `auto:${candidateId}:toggle_media`)
        .row()
        .text('🔙 Назад', `lead:${candidateId}`);

      const text =
        `⚙️ *Управление политикой автоматизации для ${candidate.displayName}*\n\n` +
        `*Текущий режим:* \`${modeText}\`\n` +
        `*Автоотправка медиа:* ${policy.neverAutosendMedia ? '⛔ Запрещена' : '✅ Разрешена'}\n\n` +
        `Выберите режим работы AI-копилота для этого контакта:`;
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
      return;
    }

    if (action === 'toggle_media') {
      const ws = await this.settingsService.getOrCreateDefault();
      const policy = await this.automationService.getPolicyForCandidate(
        candidateId,
        candidate.personaId.toString(),
        ws._id.toString(),
      );
      const newNeverSend = !policy.neverAutosendMedia;
      await this.automationService.setPolicy('candidate', candidateId, {
        mode: policy.mode as any,
        neverAutosendMedia: newNeverSend,
      });
      await ctx.answerCallbackQuery(newNeverSend ? 'Автоотправка медиа запрещена' : 'Автоотправка медиа разрешена');
      await this.handleAutomation(ctx, [candidateId, 'menu']);
      return;
    }

    if (action === 'set') {
      const mode = params[2];
      await this.automationService.setPolicy('candidate', candidateId, { mode });
      await ctx.answerCallbackQuery(`Режим автоматизации изменен на: ${mode}`);
      await this.render(ctx, [candidateId]);
    }
  }
}
