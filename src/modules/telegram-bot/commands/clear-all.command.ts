import { Injectable, Logger } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Candidate } from '@modules/contacts/schemas/candidate.schema';
import { Message } from '@modules/messages/schemas/message.schema';
import { Conversation } from '@modules/conversations/schemas/conversation.schema';
import { MemoryItem } from '@modules/memory/schemas/memory-item.schema';
import { FunnelStageState } from '@modules/funnel/schemas/funnel-stage-state.schema';
import { AuditService } from '@modules/audit/audit.service';
import { SettingsService } from '@modules/settings/settings.service';

@Injectable()
export class ClearAllCommand {
  private readonly logger = new Logger(ClearAllCommand.name);

  constructor(
    @InjectModel(Candidate.name) private readonly candidateModel: Model<Candidate>,
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    @InjectModel(Conversation.name) private readonly conversationModel: Model<Conversation>,
    @InjectModel(MemoryItem.name) private readonly memoryModel: Model<MemoryItem>,
    @InjectModel(FunnelStageState.name) private readonly funnelModel: Model<FunnelStageState>,
    private readonly auditService: AuditService,
    private readonly settingsService: SettingsService,
  ) {}

  async handle(ctx: BotContext): Promise<void> {
    const keyboard = new InlineKeyboard()
      .text('⚠️ ДА, УДАЛИТЬ ВСЁ', 'clear_all:confirm')
      .row()
      .text('❌ Отмена', 'menu');

    await ctx.reply(
      `🚨 *ВНИМАНИЕ: Полная очистка базы данных*\n\n` +
        `Эта операция удалит:\n` +
        `• Все контакты (лиды)\n` +
        `• Все сообщения и черновики\n` +
        `• Все диалоги\n` +
        `• Все факты из памяти\n` +
        `• Все состояния воронки\n\n` +
        `⚠️ *Это действие НЕОБРАТИМО!*\n\n` +
        `Вы уверены?`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  }

  async handleConfirm(ctx: BotContext): Promise<void> {
    const ws = await this.settingsService.getOrCreateDefault();

    this.logger.warn('🚨 CLEAR ALL initiated by admin');

    // Delete all data collections
    const [candidates, messages, conversations, memory, funnels] = await Promise.all([
      this.candidateModel.deleteMany({}).exec(),
      this.messageModel.deleteMany({}).exec(),
      this.conversationModel.deleteMany({}).exec(),
      this.memoryModel.deleteMany({}).exec(),
      this.funnelModel.deleteMany({}).exec(),
    ]);

    await this.auditService.log({
      workspaceId: ws._id.toString(),
      action: 'system.clear_all',
      actor: 'admin',
      details: {
        triggeredBy: ctx.from?.id?.toString(),
        deleted: {
          candidates: candidates.deletedCount,
          messages: messages.deletedCount,
          conversations: conversations.deletedCount,
          memoryItems: memory.deletedCount,
          funnelStates: funnels.deletedCount,
        },
      },
    });

    this.logger.warn(
      `CLEAR ALL complete: ${candidates.deletedCount} candidates, ${messages.deletedCount} messages, ` +
        `${conversations.deletedCount} conversations, ${memory.deletedCount} memory items, ${funnels.deletedCount} funnel states`,
    );

    const keyboard = new InlineKeyboard()
      .text('🏠 Меню', 'menu');

    await ctx.editMessageText(
      `✅ *База данных очищена*\n\n` +
        `Удалено:\n` +
        `• Контактов: ${candidates.deletedCount}\n` +
        `• Сообщений: ${messages.deletedCount}\n` +
        `• Диалогов: ${conversations.deletedCount}\n` +
        `• Фактов: ${memory.deletedCount}\n` +
        `• Состояний воронки: ${funnels.deletedCount}`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  }
}
