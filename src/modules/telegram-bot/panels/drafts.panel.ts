import { Injectable, Logger } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message } from '@modules/messages/schemas/message.schema';
import { Candidate } from '@modules/contacts/schemas/candidate.schema';
import { MessagesService } from '@modules/messages/messages.service';
import { MessageSenderService } from '@modules/messages/message-sender.service';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { AiOrchestratorService, RewriteStyle } from '@modules/ai/ai-orchestrator.service';
import { SettingsService } from '@modules/settings/settings.service';
import { AuditService } from '@modules/audit/audit.service';
import { ContentGroupService } from '@modules/content-group/content-group.service';
import { InboundPipelineService } from '@modules/ai/services/inbound-pipeline.service';

@Injectable()
export class DraftsPanel {
  private readonly logger = new Logger(DraftsPanel.name);

  constructor(
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    @InjectModel(Candidate.name) private readonly candidateModel: Model<Candidate>,
    private readonly messagesService: MessagesService,
    private readonly messageSenderService: MessageSenderService,
    private readonly conversationsService: ConversationsService,
    private readonly aiOrchestratorService: AiOrchestratorService,
    private readonly settingsService: SettingsService,
    private readonly auditService: AuditService,
    private readonly contentGroupService: ContentGroupService,
  ) {}

  async render(ctx: BotContext, params: string[]): Promise<void> {
    const subAction = params[0] || 'list';

    if (subAction === 'list') {
      const drafts = await this.messageModel
        .find({ isDraft: true })
        .sort({ createdAt: -1 })
        .limit(10)
        .exec();

      const keyboard = new InlineKeyboard();
      for (const d of drafts) {
        const candidate = await this.candidateModel.findById(d.candidateId).exec();
        const leadName = candidate ? candidate.displayName : 'Unknown';
        const txtSnippet = d.normalizedText.substring(0, 20) + (d.normalizedText.length > 20 ? '...' : '');
        keyboard.text(`📝 ${leadName}: ${txtSnippet}`, `draft:view:${d._id}`).row();
      }

      keyboard.text('🔄 Обновить', 'drafts:list')
        .row()
        .text('🔙 Назад', 'menu');

      let text = `📝 *Список active-черновиков (Всего: ${drafts.length})*\n\n`;
      if (drafts.length === 0) {
        text += `Нет черновиков, ожидающих проверки.`;
      } else {
        text += `Выберите черновик для просмотра и отправки:`;
      }

      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  }

  async handleDraftAction(ctx: BotContext, params: string[]): Promise<void> {
    const action = params[0];
    const draftId = params[1];

    if (!draftId || !Types.ObjectId.isValid(draftId)) return;

    const draft = await this.messageModel.findById(draftId).exec();
    if (!draft) {
      // If the draft is not found, it might have been already deleted, cancelled, or replaced
      if (action === 'reject') {
        await ctx.answerCallbackQuery('Автоответ уже отменен или удален.').catch(() => {});
        try {
          await ctx.editMessageText('❌ Автоответ отменен.');
        } catch (_) {}
      } else if (action === 'send') {
        await ctx.answerCallbackQuery('Сообщение уже отправлено или удалено.').catch(() => {});
        try {
          await ctx.editMessageText('⚠️ Сообщение не найдено (возможно, уже отправлено).');
        } catch (_) {}
      } else {
        await ctx.reply('❌ Черновик не найден.');
      }
      return;
    }

    if (!draft.isDraft) {
      // If the draft is found but is no longer a draft (already sent)
      if (action === 'reject' || action === 'send') {
        await ctx.answerCallbackQuery('Сообщение уже отправлено.').catch(() => {});
        try {
          await ctx.editMessageText('🟢 Сообщение уже отправлено.');
        } catch (_) {}
      } else {
        await ctx.reply('⚠️ Этот ответ уже был отправлен.');
      }
      return;
    }

    const candidate = await this.candidateModel.findById(draft.candidateId).exec();
    const leadName = candidate ? candidate.displayName : 'Unknown';

    if (action === 'view') {
      const keyboard = new InlineKeyboard()
        .text('✅ Отправить', `draft:send:${draftId}`)
        .text('❌ Удалить', `draft:reject:${draftId}`)
        .row()
        .text('✍️ Переписать (Тон)', `draft:rewrite_menu:${draftId}`)
        .row()
        .text('🔙 Назад', 'drafts:list');

      const safetyStatusEmoji = draft.safetyStatus === 'safe' ? '✅ Safe' : draft.safetyStatus === 'review' ? '⚠️ Review Required' : '🚫 Blocked';
      
      let mediaAttachedText = '';
      if (draft.mediaItemId) {
        try {
          const mediaItem = await this.contentGroupService.getMediaItemById(draft.mediaItemId);
          if (mediaItem) {
            const capText = mediaItem.caption ? ` ("${mediaItem.caption}")` : '';
            mediaAttachedText = `\n📸 *Прикрепленное AI медиа [${mediaItem.mediaType}]:* \`${mediaItem.category}\`${capText}`;
          } else {
            mediaAttachedText = `\n📸 *Прикрепленное AI медиа:* \`${draft.mediaItemId}\` (не найдено в базе)`;
          }
        } catch (e: any) {
          mediaAttachedText = `\n📸 *Прикрепленное AI медиа:* \`${draft.mediaItemId}\``;
        }
      } else if (draft.mediaCategory) {
        mediaAttachedText = `\n📸 *Будет прикреплен контент из категории:* \`${draft.mediaCategory}\``;
      }

      const text =
          `📝 *Просмотр черновика*\n\n` +
          `*Получатель:* ${leadName}\n` +
          `*Уверенность AI:* \`${Math.round(draft.confidence * 100)}%\` (${safetyStatusEmoji})\n` +
          `*Тон:* \`${draft.draftTone || 'Не указан'}\`${mediaAttachedText}\n\n` +
          `💬 *Текст сообщения:*\n_${draft.normalizedText}_`;

      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
      return;
    }

    if (action === 'send') {
      const ws = await this.settingsService.getOrCreateDefault();
      
      // Answer callback query immediately to prevent "query is too old" errors from slow typing simulations
      await ctx.answerCallbackQuery('Отправляю...').catch(() => {});

      try {
        await this.messageSenderService.sendViaBridge(draftId);
        await this.render(ctx, ['list']);
      } catch (err: any) {
        if (err.message === 'BRIDGE_NOT_CONNECTED') {
          // Fallback to prompter mode: approve the draft in DB and display for copy-paste
          await this.messagesService.approveDraft(draftId);

          await this.auditService.log({
            workspaceId: ws._id.toString(),
            personaId: draft.personaId.toString(),
            candidateId: draft.candidateId.toString(),
            action: 'draft.approved',
            actor: 'admin',
            details: { text: draft.normalizedText, note: 'Fallback to prompter mode' },
          });

          const keyboard = new InlineKeyboard().text('🔙 К черновикам', 'drafts:list');
          await ctx.editMessageText(
            `⚠️ *Bridge не подключен!*\n\n` +
            `Черновик одобрен и сохранён как отправленный в системе.\n` +
            `Скопируйте текст сообщения ниже для ручной отправки:\n\n` +
            `\`${draft.normalizedText}\``,
            { parse_mode: 'Markdown', reply_markup: keyboard },
          );
        } else {
          this.logger.error(`Failed to send message: ${err.message}`);
          await ctx.reply(`❌ Ошибка отправки: ${err.message}`);
        }
      }
      return;
    }

    if (action === 'reject') {
      const ws = await this.settingsService.getOrCreateDefault();
      
      // Clear any pending automated timeouts for this candidate/message if rejected
      for (const [candId, pending] of InboundPipelineService.pendingAutosends.entries()) {
        if (pending.msgId === draftId) {
          clearTimeout(pending.timeoutId);
          if (pending.readTimeoutId) {
            clearTimeout(pending.readTimeoutId);
          }
          InboundPipelineService.pendingAutosends.delete(candId);
          this.logger.log(`Cancelled scheduled autopilot send for candidate ${candId} because message ${draftId} was rejected/deleted`);
          break;
        }
      }

      await this.messagesService.deleteDraft(draftId);

      await this.auditService.log({
        workspaceId: ws._id.toString(),
        personaId: draft.personaId.toString(),
        candidateId: draft.candidateId.toString(),
        action: 'draft.rejected',
        actor: 'admin',
        details: {},
      });

      await ctx.answerCallbackQuery('Черновик удален.');
      await this.render(ctx, ['list']);
      return;
    }

    if (action === 'rewrite_menu') {
      const keyboard = new InlineKeyboard()
        .text('❄️ Холоднее (Cooler)', `rewrite:${draftId}:cooler`)
        .row()
        .text('🔥 Теплее (Warmer)', `rewrite:${draftId}:warmer`)
        .row()
        .text('⚡ Короче (Shorter)', `rewrite:${draftId}:shorter`)
        .row()
        .text('🗣 Small Talk', `rewrite:${draftId}:small_talk`)
        .row()
        .text('📞 К созвону (To Call)', `rewrite:${draftId}:to_call`)
        .row()
        .text('🔙 Назад', `draft:view:${draftId}`);

      const text = `✍️ *Переписать черновик для ${leadName}*\n\nВыберите стиль или цель для изменения тона AI:`;
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  }

  async handleRewrite(ctx: BotContext, params: string[]): Promise<void> {
    const draftId = params[0];
    const style = params[1] as RewriteStyle;

    if (!draftId || !style) return;

    const draft = await this.messageModel.findById(draftId).exec();
    if (!draft) return;

    await ctx.answerCallbackQuery('Переписываю...');

    try {
      const result = await this.aiOrchestratorService.rewriteDraft(
        draft.normalizedText,
        style,
        draft.personaId.toString(),
        draft.candidateId.toString(),
      );

      await this.messagesService.updateDraftText(draftId, result.text, result.tone);

      await this.handleDraftAction(ctx, ['view', draftId]);
    } catch (err) {
      this.logger.error(`Failed to rewrite draft: ${(err as Error).message}`, (err as Error).stack);
      
      const keyboard = new InlineKeyboard().text('🔙 Назад', `draft:view:${draftId}`);
      await ctx.editMessageText(
        `❌ *Ошибка переписывания черновика*\n\n` +
        `Не удалось связаться с AI-провайдером. Ошибка: \`${(err as Error).message}\`\n\n` +
        `🔧 *Что проверить:*\n` +
        `1. Убедитесь, что \`OPENAI_API_KEY\` в файле \`.env\` заполнен правильно.\n` +
        `2. Проверьте стабильность интернет-соединения.\n` +
        `3. Если используется Hugging Face, возможно превышен лимит бесплатных запросов.`,
        { parse_mode: 'Markdown', reply_markup: keyboard }
      ).catch(() => {});
    }
  }

  async handleGenerate(ctx: BotContext, params: string[]): Promise<void> {
    const candidateId = params[0];
    if (!candidateId || !Types.ObjectId.isValid(candidateId)) return;

    const candidate = await this.candidateModel.findById(candidateId).exec();
    if (!candidate) return;

    await ctx.answerCallbackQuery('Генерирую черновик...');

    try {
      const draftResult = await this.aiOrchestratorService.generateDraft(
        candidate.personaId.toString(),
        candidateId,
      );

      const conv = await this.conversationsService.findOrCreate(
        candidate.personaId.toString(),
        candidateId,
      );

      const draftMsg = await this.messagesService.createMessage({
        conversationId: conv._id,
        personaId: candidate.personaId,
        candidateId: candidate._id,
        telegramMessageId: Math.floor(Math.random() * 1000000),
        direction: 'outbound',
        isDraft: true,
        normalizedText: draftResult.text,
        confidence: draftResult.confidence,
        safetyStatus: draftResult.safety.blocked ? 'blocked' : draftResult.safety.flagged ? 'review' : 'safe',
        draftTone: draftResult.tone,
        mediaCategory: (draftResult as any).mediaCategory || null,
        mediaItemId: draftResult.attachedMediaId || null,
        sentAt: new Date(),
      });

      await this.handleDraftAction(ctx, ['view', draftMsg._id.toString()]);
    } catch (err) {
      this.logger.error(`Failed to generate draft: ${(err as Error).message}`, (err as Error).stack);
      
      const keyboard = new InlineKeyboard().text('🔙 Назад', `lead:${candidateId}`);
      await ctx.editMessageText(
        `❌ *Ошибка генерации черновика*\n\n` +
        `Не удалось связаться с AI-провайдером. Ошибка: \`${(err as Error).message}\`\n\n` +
        `🔧 *Что проверить:*\n` +
        `1. Убедитесь, что \`OPENAI_API_KEY\` в файле \`.env\` заполнен правильно.\n` +
        `2. Проверьте стабильность интернет-соединения.\n` +
        `3. Если используется Hugging Face, возможно превышен лимит запросов.`,
        { parse_mode: 'Markdown', reply_markup: keyboard }
      ).catch(() => {});
    }
  }
}
