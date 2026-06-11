import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Bot } from 'grammy';
import { BotContext, BOT_INSTANCE } from '@infrastructure/telegram/telegram.constants';
import { AiOrchestratorService } from '../ai-orchestrator.service';
import { MessagesService } from '@modules/messages/messages.service';
import { MessageSenderService } from '@modules/messages/message-sender.service';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { MemoryService } from '@modules/memory/memory.service';
import { AutomationService } from '@modules/automation/automation.service';
import { SettingsService } from '@modules/settings/settings.service';
import { AuditService } from '@modules/audit/audit.service';
import { ConfigService } from '@nestjs/config';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';
import { Candidate } from '@modules/contacts/schemas/candidate.schema';
import { InlineKeyboard } from 'grammy';
import { ContentGroupService } from '@modules/content-group/content-group.service';
import { MtprotoBridgeService } from '@infrastructure/telegram/mtproto-bridge.service';

@Injectable()
export class InboundPipelineService {
  private readonly logger = new Logger(InboundPipelineService.name);
  public static readonly pendingAutosends = new Map<string, { timeoutId: NodeJS.Timeout; readTimeoutId?: NodeJS.Timeout; msgId: string }>();

  constructor(
    private readonly aiOrchestrator: AiOrchestratorService,
    private readonly messagesService: MessagesService,
    private readonly messageSender: MessageSenderService,
    private readonly conversationsService: ConversationsService,
    private readonly memoryService: MemoryService,
    private readonly automationService: AutomationService,
    private readonly settingsService: SettingsService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    private readonly contentGroupService: ContentGroupService,
    private readonly bridgeService: MtprotoBridgeService,
    @Inject(BOT_INSTANCE) private readonly bot: Bot<BotContext> | null,
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
    @InjectModel(Candidate.name) private readonly candidateModel: Model<Candidate>,
  ) {}

  /**
   * Run the inbound message processing pipeline:
   * 1. Extract memory facts from the incoming message
   * 2. Generate an AI draft response
   * 3. Evaluate automation policies (autosend vs manual draft)
   * 4. Send response via bridge (if autosend) or notify admin (if draft)
   */
  async processInbound(
    personaId: string,
    candidateId: string,
    messageText: string,
    adminChatId?: string,
  ): Promise<void> {
    try {
      this.logger.log(`Starting inbound pipeline for candidate ${candidateId} (persona: ${personaId})`);

      // Cancel any pending scheduled autopilot sends for this candidate to prevent double-replying
      const pending = InboundPipelineService.pendingAutosends.get(candidateId);
      if (pending) {
        clearTimeout(pending.timeoutId);
        if (pending.readTimeoutId) {
          clearTimeout(pending.readTimeoutId);
        }
        InboundPipelineService.pendingAutosends.delete(candidateId);
        this.logger.log(`Cancelled previous pending autosend message ${pending.msgId} for candidate ${candidateId}`);
        await this.messagesService.deleteDraft(pending.msgId).catch(() => {});
      }

      const persona = await this.personaModel.findById(personaId).exec();
      const candidate = await this.candidateModel.findById(candidateId).exec();

      if (!persona || !candidate) {
        this.logger.error(`Persona (${personaId}) or Candidate (${candidateId}) not found. Aborting pipeline.`);
        return;
      }

      // Step 1: Extract memory facts in background (does not block draft generation)
      this.memoryService.extractFromMessage(
        personaId,
        candidateId,
        messageText,
      ).catch((err) => this.logger.error(`Memory extraction failed: ${err.message}`));

      // Step 2: Generate draft response
      const draftResult = await this.aiOrchestrator.generateDraft(personaId, candidateId);

      const conv = await this.conversationsService.findOrCreate(personaId, candidateId);

      // Save draft to database
      const draftMsg = await this.messagesService.createMessage({
        conversationId: conv._id,
        personaId: new Types.ObjectId(personaId),
        candidateId: new Types.ObjectId(candidateId),
        telegramMessageId: Math.floor(Math.random() * 1000000),
        direction: 'outbound',
        isDraft: true,
        normalizedText: draftResult.text,
        confidence: draftResult.confidence,
        safetyStatus: draftResult.safety.blocked ? 'blocked' : draftResult.safety.flagged ? 'review' : 'safe',
        draftTone: draftResult.tone,
        mediaCategory: draftResult.mediaCategory || null,
        mediaItemId: draftResult.attachedMediaId || null,
        sentAt: new Date(),
      });

      // Step 3: Evaluate automation policy
      const ws = await this.settingsService.getOrCreateDefault();
      const evaluation = await this.automationService.evaluateAutomation(
        candidateId,
        personaId,
        ws._id,
        draftResult.confidence,
        [],
        !!draftResult.attachedMediaId || !!draftResult.mediaCategory,
      );

      // Step 4: Handle auto-send vs manual approval
      if (evaluation.autosend) {
        // Calculate delay between 3 and 10 minutes depending on text length
        const textLengthFactor = Math.min(1.0, draftMsg.normalizedText.length / 500); // 0 to 1
        const baseMin = 3 + textLengthFactor * 3; // 3 to 6 mins
        const baseMax = 7 + textLengthFactor * 4; // 7 to 10 mins
        let delayMs = (Math.random() * (baseMax - baseMin) + baseMin) * 60 * 1000;

        // 5% chance of rare longer delay (12 to 20 minutes)
        if (Math.random() < 0.05) {
          delayMs = (Math.random() * (20 - 12) + 12) * 60 * 1000;
        }

        this.logger.log(`Scheduling autopilot reply for candidate ${candidateId} in ${(delayMs / 1000 / 60).toFixed(1)} minutes`);

        // Mark as read after a realistic human delay (e.g. 5 to 15 seconds)
        const readDelayMs = Math.floor(Math.random() * 10000) + 5000;
        const readTimeoutId = setTimeout(async () => {
          try {
            await this.bridgeService.readHistory(personaId, candidate.telegramUserId);
          } catch (err: any) {
            this.logger.warn(`Failed to mark history as read for candidate ${candidate.telegramUserId}: ${err.message}`);
          }
        }, readDelayMs);

        const timeoutId = setTimeout(async () => {
          InboundPipelineService.pendingAutosends.delete(candidateId);
          try {
            await this.messageSender.sendViaBridge(draftMsg._id.toString());
            
            // Log auto-send audit event
            await this.auditService.log({
              workspaceId: ws._id.toString(),
              personaId,
              candidateId,
              action: 'message_autosent_bridge',
              actor: 'system',
              details: { messageId: draftMsg._id.toString() },
            });

            await this.notifyAdmins(persona, candidate, draftMsg, messageText, draftResult, true, undefined, undefined);
          } catch (err: any) {
            this.logger.error(`Auto-send via bridge failed: ${err.message}. Falling back to admin notification.`);
            await this.notifyAdmins(persona, candidate, draftMsg, messageText, draftResult, false, err.message, undefined);
          }
        }, delayMs);

        InboundPipelineService.pendingAutosends.set(candidateId, {
          timeoutId,
          readTimeoutId,
          msgId: draftMsg._id.toString(),
        });

        // Notify admins that the response is scheduled
        await this.notifyAdmins(persona, candidate, draftMsg, messageText, draftResult, false, undefined, delayMs);
      } else {
        // Notify admins for manual approval immediately
        await this.notifyAdmins(persona, candidate, draftMsg, messageText, draftResult, false, undefined, undefined);
      }
    } catch (err: any) {
      this.logger.error(`Error in inbound pipeline: ${err.message}`, err.stack);
    }
  }

  private async notifyAdmins(
    persona: Persona,
    candidate: Candidate,
    draftMsg: any,
    messageText: string,
    draftResult: any,
    autoSent: boolean,
    sendError?: string,
    delayMs?: number,
  ): Promise<void> {
    if (!this.bot) return;

    // Collect target chats to notify
    const targetChats = new Set<string>();
    const configAdmins = this.configService.get<string>('ADMIN_TELEGRAM_IDS', '');
    if (configAdmins) {
      configAdmins.split(',').forEach((id) => {
        const cleanId = id.trim();
        if (cleanId) targetChats.add(cleanId);
      });
    }

    // Prepare keyboard and message text
    const keyboard = new InlineKeyboard();
    let statusNotice = '';

    if (autoSent) {
      statusNotice = `🟢 *Автоотправлено через Bridge!*`;
      keyboard.text('🔙 Меню', 'menu');
    } else if (delayMs !== undefined) {
      const mins = (delayMs / 1000 / 60).toFixed(1);
      statusNotice = `⏳ *Автоответ запланирован через ${mins} мин.* Бот ответит сам.`;
      
      keyboard
        .text('✅ Отправить сейчас', `draft:send:${draftMsg._id}`)
        .text('❌ Отменить автоответ', `draft:reject:${draftMsg._id}`)
        .row()
        .text('✍️ Переписать (Тон)', `draft:rewrite_menu:${draftMsg._id}`)
        .row()
        .text('🔙 Меню', 'menu');
    } else {
      statusNotice = sendError 
        ? `⚠️ *Ошибка автоотправки (${sendError}).* Требуется ручное одобрение:`
        : `⏳ *Ожидает проверки (Режим: Только черновик):*`;

      keyboard
        .text('✅ Отправить', `draft:send:${draftMsg._id}`)
        .text('❌ Удалить', `draft:reject:${draftMsg._id}`)
        .row()
        .text('✍️ Переписать (Тон)', `draft:rewrite_menu:${draftMsg._id}`)
        .row()
        .text('🔙 Меню', 'menu');
    }

    const safetyStatusEmoji = draftMsg.safetyStatus === 'safe' ? '✅ Safe' : draftMsg.safetyStatus === 'review' ? '⚠️ Review' : '🚫 Blocked';
    
    let mediaNotice = '';
    if (draftResult.attachedMediaId) {
      try {
        const mediaItem = await this.contentGroupService.getMediaItemById(draftResult.attachedMediaId);
        if (mediaItem) {
          const capText = mediaItem.caption ? ` ("${mediaItem.caption}")` : '';
          mediaNotice = `📸 *Прикреплено AI медиа [${mediaItem.mediaType}]:* \`${mediaItem.category}\`${capText}\n\n`;
        } else {
          mediaNotice = `📸 *Прикреплено AI медиа:* \`${draftResult.attachedMediaId}\` (не найдено в базе)\n\n`;
        }
      } catch (e: any) {
        mediaNotice = `📸 *Прикреплено AI медиа:* \`${draftResult.attachedMediaId}\`\n\n`;
      }
    } else if (draftResult.mediaCategory) {
      mediaNotice = `📸 *Будет прикреплено фото/видео из категории:* \`${draftResult.mediaCategory}\`\n\n`;
    }

    const notificationText =
      `🔔 *Новое сообщение от кандидата!*\n\n` +
      `*Аккаунт:* ${persona.name} (@${persona.telegramAccountId})\n` +
      `*От:* ${candidate.displayName} (\`${candidate.telegramUserId}\`)\n` +
      `💬 *Кандидат:* _${messageText}_\n\n` +
      `🤖 *Предложенный ответ:* \n_${draftResult.text}_\n\n` +
      mediaNotice +
      `⚙️ *Статус AI:* Уверенность ${Math.round(draftResult.confidence * 100)}% | ${safetyStatusEmoji}\n\n` +
      `${statusNotice}`;

    for (const chatId of targetChats) {
      try {
        await this.bot.api.sendMessage(chatId, notificationText, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      } catch (err: any) {
        this.logger.error(`Failed to send telegram notification to admin ${chatId}: ${err.message}`);
      }
    }
  }
}
