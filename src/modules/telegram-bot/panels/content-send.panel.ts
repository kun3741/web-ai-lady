import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InlineKeyboard } from 'grammy';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { ContentGroupService } from '@modules/content-group/content-group.service';
import { ContactsService } from '@modules/contacts/contacts.service';
import { MessagesService } from '@modules/messages/messages.service';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { FunnelService } from '@modules/funnel/funnel.service';
import { MtprotoBridgeService } from '@infrastructure/telegram/mtproto-bridge.service';
import { SettingsService } from '@modules/settings/settings.service';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';

@Injectable()
export class ContentSendPanel {
  private readonly logger = new Logger(ContentSendPanel.name);

  constructor(
    private readonly contentGroupService: ContentGroupService,
    private readonly contactsService: ContactsService,
    private readonly messagesService: MessagesService,
    private readonly conversationsService: ConversationsService,
    private readonly funnelService: FunnelService,
    private readonly bridgeService: MtprotoBridgeService,
    private readonly settingsService: SettingsService,
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
  ) {}

  async handleAction(ctx: BotContext, params: string[]): Promise<void> {
    const action = params[0] || 'menu';
    const candidateId = params[1];

    if (!candidateId || !Types.ObjectId.isValid(candidateId)) {
      await ctx.answerCallbackQuery('❌ Некорректный ID кандидата.');
      return;
    }

    if (action === 'menu') {
      await this.renderMenu(ctx, candidateId);
    } else if (action === 'stage') {
      await this.handleSendStage(ctx, candidateId);
    } else if (action === 'category') {
      const category = params[2];
      await this.handleSendCategory(ctx, candidateId, category);
    }
  }

  async renderMenu(ctx: BotContext, candidateId: string): Promise<void> {
    const candidate = await this.contactsService.findById(candidateId);
    if (!candidate) {
      await ctx.answerCallbackQuery('❌ Кандидат не найден.');
      return;
    }

    const funnelState = await this.funnelService.getOrCreate(
      candidateId,
      candidate.personaId.toString(),
    );
    const currentStage = funnelState.stage;

    const ws = await this.settingsService.getOrCreateDefault();
    const groupId = ws.contentGroupId || '2183482722';

    const categories = await this.contentGroupService.getAvailableCategories(groupId, currentStage);

    const keyboard = new InlineKeyboard()
      .text(`🎯 По этапу воронки (${currentStage})`, `content_send:stage:${candidateId}`)
      .row();

    // Show dynamic list of categories in 2 columns
    let colCount = 0;
    for (const cat of categories) {
      // Add custom emoji mapping for visual flair
      let emoji = '📸';
      if (cat === 'home') emoji = '🏠';
      else if (cat === 'work') emoji = '💼';
      else if (cat === 'travel_everyday' || cat === 'travel_abroad') emoji = '✈️';
      else if (cat === 'playful' || cat === 'exclusive') emoji = '🤫';
      else if (cat === 'food') emoji = '🍕';
      else if (cat === 'sport') emoji = '🏃‍♀️';
      else if (cat === 'pets') emoji = '🐱';
      else if (cat === 'hobbies') emoji = '🎨';
      else if (cat === 'beauty') emoji = '💄';
      else if (cat === 'friends') emoji = '👩‍❤️‍👩';

      keyboard.text(`${emoji} ${cat}`, `content_send:category:${candidateId}:${cat}`);
      colCount++;
      if (colCount % 2 === 0) {
        keyboard.row();
      }
    }

    if (colCount % 2 !== 0) {
      keyboard.row();
    }

    keyboard.text('🔙 Назад к лиду', `lead:${candidateId}`);

    const text =
      `📸 *Отправка контента лиду: ${candidate.displayName}*\n\n` +
      `*Текущий этап воронки:* \`${currentStage}\`\n\n` +
      `Выберите опцию ниже для случайного выбора фото/видео из контент-группы и отправки в чат с кандидатом.`;

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  async handleSendStage(ctx: BotContext, candidateId: string): Promise<void> {
    const candidate = await this.contactsService.findById(candidateId);
    if (!candidate) {
      await ctx.answerCallbackQuery('❌ Кандидат не найден.');
      return;
    }

    const personaId = candidate.personaId.toString();
    if (!this.bridgeService.isConnected(personaId)) {
      await ctx.answerCallbackQuery({
        text: '❌ Bridge не подключен для этого аккаунта! Подключите сначала.',
        show_alert: true,
      });
      return;
    }

    const funnelState = await this.funnelService.getOrCreate(candidateId, personaId);
    const stage = funnelState.stage;

    const ws = await this.settingsService.getOrCreateDefault();
    const groupId = ws.contentGroupId || '2183482722';

    await ctx.editMessageText(`⏳ *Поиск и отправка контента для этапа "${stage}"...*`, {
      parse_mode: 'Markdown',
    });

    try {
      const content = await this.contentGroupService.fetchContentForStage(
        groupId,
        personaId,
        stage,
        candidateId,
      );

      if (!content) {
        await ctx.answerCallbackQuery({
          text: `⚠️ Нет доступного нового контента для этапа "${stage}" в базе.`,
          show_alert: true,
        });
        await this.renderMenu(ctx, candidateId);
        return;
      }

      // Send via MTProto bridge
      await this.bridgeService.sendMedia(
        personaId,
        candidate.telegramUserId,
        content.buffer,
        content.filename,
        content.caption,
        {
          voiceNote: content.isVoice,
          videoNote: content.isRoundVideo,
        },
      );

      // Save to candidate's sentContentMessageIds
      if (content.messageId) {
        await this.contactsService.addSentMediaId(candidateId, `${groupId}:${content.messageId}`);
      }

      // Record message in DB
      const conv = await this.conversationsService.findOrCreate(
        personaId,
        candidateId,
        candidate.telegramUserId,
      );
      await this.messagesService.createMessage({
        conversationId: conv._id,
        personaId: new Types.ObjectId(personaId),
        candidateId: new Types.ObjectId(candidateId),
        telegramMessageId: Math.floor(Date.now() / 1000),
        direction: 'outbound',
        normalizedText: content.caption || `[Фото/видео из темы: ${content.topicTitle}]`,
        mediaType: content.isVoice
          ? 'voice'
          : content.isRoundVideo
            ? 'video_note'
            : content.mimeType.startsWith('image')
              ? 'photo'
              : 'video',
        mediaCategory: content.category,
        sentAt: new Date(),
        isDraft: false,
      });

      await ctx.answerCallbackQuery({
        text: `✅ Успешно отправлен контент из темы "${content.topicTitle}"!`,
        show_alert: true,
      });
    } catch (err: any) {
      this.logger.error(`Failed to send stage content: ${err.message}`, err.stack);
      await ctx.answerCallbackQuery({
        text: `❌ Ошибка отправки: ${err.message}`,
        show_alert: true,
      });
    }

    await this.renderMenu(ctx, candidateId);
  }

  async handleSendCategory(ctx: BotContext, candidateId: string, category: string): Promise<void> {
    const candidate = await this.contactsService.findById(candidateId);
    if (!candidate) {
      await ctx.answerCallbackQuery('❌ Кандидат не найден.');
      return;
    }

    const personaId = candidate.personaId.toString();
    if (!this.bridgeService.isConnected(personaId)) {
      await ctx.answerCallbackQuery({
        text: '❌ Bridge не подключен для этого аккаунта! Подключите сначала.',
        show_alert: true,
      });
      return;
    }

    const ws = await this.settingsService.getOrCreateDefault();
    const groupId = ws.contentGroupId || '2183482722';

    const funnelState = await this.funnelService.getOrCreate(candidateId, personaId);
    const stage = funnelState.stage;

    await ctx.editMessageText(`⏳ *Поиск и отправка контента из категории "${category}"...*`, {
      parse_mode: 'Markdown',
    });

    try {
      const content = await this.contentGroupService.fetchContentByCategory(
        groupId,
        personaId,
        category,
        stage,
        candidateId,
      );

      if (!content) {
        await ctx.answerCallbackQuery({
          text: `⚠️ Нет доступного нового контента в категории "${category}".`,
          show_alert: true,
        });
        await this.renderMenu(ctx, candidateId);
        return;
      }

      // Send via MTProto bridge
      await this.bridgeService.sendMedia(
        personaId,
        candidate.telegramUserId,
        content.buffer,
        content.filename,
        content.caption,
        {
          voiceNote: content.isVoice,
          videoNote: content.isRoundVideo,
        },
      );

      // Save to candidate's sentContentMessageIds
      if (content.messageId) {
        await this.contactsService.addSentMediaId(candidateId, `${groupId}:${content.messageId}`);
      }

      // Record message in DB
      const conv = await this.conversationsService.findOrCreate(
        personaId,
        candidateId,
        candidate.telegramUserId,
      );
      await this.messagesService.createMessage({
        conversationId: conv._id,
        personaId: new Types.ObjectId(personaId),
        candidateId: new Types.ObjectId(candidateId),
        telegramMessageId: Math.floor(Date.now() / 1000),
        direction: 'outbound',
        normalizedText: content.caption || `[Фото/видео из темы: ${content.topicTitle}]`,
        mediaType: content.isVoice
          ? 'voice'
          : content.isRoundVideo
            ? 'video_note'
            : content.mimeType.startsWith('image')
              ? 'photo'
              : 'video',
        mediaCategory: content.category,
        sentAt: new Date(),
        isDraft: false,
      });

      await ctx.answerCallbackQuery({
        text: `✅ Успешно отправлен контент из темы "${content.topicTitle}"!`,
        show_alert: true,
      });
    } catch (err: any) {
      this.logger.error(`Failed to send category content: ${err.message}`, err.stack);
      await ctx.answerCallbackQuery({
        text: `❌ Ошибка отправки: ${err.message}`,
        show_alert: true,
      });
    }

    await this.renderMenu(ctx, candidateId);
  }
}
