import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message } from './schemas/message.schema';
import { MessagesService } from './messages.service';
import { ContactsService } from '@modules/contacts/contacts.service';
import { MtprotoBridgeService } from '@infrastructure/telegram/mtproto-bridge.service';
import { AuditService } from '@modules/audit/audit.service';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';
import { SettingsService } from '@modules/settings/settings.service';
import { ContentGroupService } from '@modules/content-group/content-group.service';
import { FunnelService } from '@modules/funnel/funnel.service';

import { InboundPipelineService } from '@modules/ai/services/inbound-pipeline.service';

@Injectable()
export class MessageSenderService {
  private readonly logger = new Logger(MessageSenderService.name);

  constructor(
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
    private readonly messagesService: MessagesService,
    private readonly contactsService: ContactsService,
    private readonly bridgeService: MtprotoBridgeService,
    private readonly auditService: AuditService,
    private readonly settingsService: SettingsService,
    private readonly contentGroupService: ContentGroupService,
    private readonly funnelService: FunnelService,
  ) {}

  /**
   * Send a drafted message or a manual reply via MTProto bridge if connected, otherwise throw error.
   */
  async sendViaBridge(messageId: string): Promise<Message> {
    // Clear any pending automated timeouts for this candidate/message if sent manually/immediately
    for (const [candId, pending] of InboundPipelineService.pendingAutosends.entries()) {
      if (pending.msgId === messageId) {
        clearTimeout(pending.timeoutId);
        if (pending.readTimeoutId) {
          clearTimeout(pending.readTimeoutId);
        }
        InboundPipelineService.pendingAutosends.delete(candId);
        this.logger.log(
          `Cancelled scheduled autopilot send for candidate ${candId} because message ${messageId} was sent manually/immediately`,
        );
        break;
      }
    }

    const message = await this.messageModel.findById(messageId).exec();
    if (!message) {
      throw new Error('Message not found');
    }

    const candidate = await this.contactsService.findById(message.candidateId.toString());
    if (!candidate) {
      throw new Error('Candidate not found');
    }

    const personaId = message.personaId.toString();
    const persona = await this.personaModel.findById(personaId).exec();
    if (!persona) {
      throw new Error('Persona not found');
    }

    const isConnected = this.bridgeService.isConnected(personaId);

    if (!isConnected) {
      this.logger.warn(
        `Bridge not connected for persona ${personaId}, cannot send message ${messageId} automatically`,
      );
      throw new Error('BRIDGE_NOT_CONNECTED');
    }

    // Mark chat history as read right before we start typing
    await this.bridgeService.readHistory(personaId, candidate.telegramUserId).catch((err) => {
      this.logger.warn(
        `Failed to mark history as read for candidate ${candidate.telegramUserId}: ${err.message}`,
      );
    });

    const textToSend = message.normalizedText;
    if (!textToSend) {
      throw new Error('Message content is empty');
    }

    // Simulate human typing delay to avoid looking like a bot
    const typingTimeMs = Math.min(15000, Math.max(4000, textToSend.length * 60));
    this.logger.log(
      `Simulating typing for ${typingTimeMs}ms to candidate ${candidate.telegramUserId} (${candidate.displayName})`,
    );

    const start = Date.now();
    while (Date.now() - start < typingTimeMs) {
      await this.bridgeService
        .sendTypingAction(personaId, candidate.telegramUserId)
        .catch((err) => {
          this.logger.warn(
            `Failed to send typing action to candidate ${candidate.telegramUserId}: ${err.message}`,
          );
        });
      const remaining = typingTimeMs - (Date.now() - start);
      const sleepTime = Math.min(4000, remaining);
      if (sleepTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, sleepTime));
      }
    }

    let mediaSent = false;
    if (message.mediaItemId) {
      try {
        const mediaItem = await this.contentGroupService.getMediaItemById(message.mediaItemId);
        if (mediaItem) {
          const content = await this.contentGroupService.downloadMediaItem(mediaItem, personaId);
          if (content) {
            await this.bridgeService.sendMedia(
              personaId,
              candidate.telegramUserId,
              content.buffer,
              content.filename,
              textToSend,
              {
                voiceNote: content.isVoice,
                videoNote: content.isRoundVideo,
              },
            );
            mediaSent = true;
            message.mediaType = content.isVoice
              ? 'voice'
              : content.isRoundVideo
                ? 'video_note'
                : content.mimeType.startsWith('image')
                  ? 'photo'
                  : 'video';
            message.mediaCategory = content.category;

            // Save to candidate's sentContentMessageIds
            const key = `${mediaItem.groupId}:${mediaItem.messageId}`;
            await this.contactsService.addSentMediaId(candidate._id.toString(), key);

            this.logger.log(
              `Successfully sent specific mediaItemId ${message.mediaItemId} (category: ${content.category}) to candidate ${candidate._id}`,
            );
          } else {
            this.logger.warn(
              `Failed to download media item ${message.mediaItemId}. Falling back to plain text.`,
            );
          }
        } else {
          this.logger.warn(
            `Media item ${message.mediaItemId} not found in database. Falling back to plain text.`,
          );
        }
      } catch (err: any) {
        this.logger.error(
          `Failed to send media item ${message.mediaItemId}: ${err.message}. Falling back to plain text.`,
          err.stack,
        );
      }
    } else if (message.mediaCategory) {
      try {
        const ws = await this.settingsService.getOrCreateDefault();
        const groupId = ws.contentGroupId || '2183482722';
        const funnelState = await this.funnelService.getOrCreate(
          candidate._id.toString(),
          personaId,
        );

        // Pass candidateId to skip duplicate media
        const content = await this.contentGroupService.fetchContentByCategory(
          groupId,
          personaId,
          message.mediaCategory,
          funnelState.stage,
          candidate._id.toString(),
        );

        if (content) {
          await this.bridgeService.sendMedia(
            personaId,
            candidate.telegramUserId,
            content.buffer,
            content.filename,
            textToSend,
            {
              voiceNote: content.isVoice,
              videoNote: content.isRoundVideo,
            },
          );
          mediaSent = true;
          message.mediaType = content.isVoice
            ? 'voice'
            : content.isRoundVideo
              ? 'video_note'
              : content.mimeType.startsWith('image')
                ? 'photo'
                : 'video';

          // Save to candidate's sentContentMessageIds
          if (content.messageId) {
            await this.contactsService.addSentMediaId(
              candidate._id.toString(),
              `${groupId}:${content.messageId}`,
            );
          }

          this.logger.log(
            `Successfully sent media of category ${message.mediaCategory} to candidate ${candidate._id}`,
          );
        } else {
          this.logger.warn(
            `No media content found for category ${message.mediaCategory}. Falling back to plain text.`,
          );
        }
      } catch (err: any) {
        this.logger.error(
          `Failed to send media: ${err.message}. Falling back to plain text.`,
          err.stack,
        );
      }
    }

    if (!mediaSent) {
      // Send via GramJS MTProto client
      await this.bridgeService.sendMessage(personaId, candidate.telegramUserId, textToSend);
    }

    // Update message status to sent
    message.isDraft = false;
    message.direction = 'outbound';
    message.sentAt = new Date();
    const updatedMessage = await message.save();

    // Trigger post-send hook in messages service (which updates conversation/candidate stats)
    // Actually, createMessage does this, but since we are modifying an existing draft,
    // we should manually update contact & conversation lastMessage time.
    await this.contactsService.updateLastMessage(candidate._id.toString(), 'outbound');

    // Log audit event
    await this.auditService
      .log({
        workspaceId: persona.workspaceId?.toString() || '',
        personaId,
        candidateId: candidate._id.toString(),
        action: 'message_sent_bridge',
        actor: 'admin',
        details: { messageId, textLength: textToSend.length },
      })
      .catch((err) => this.logger.error(`Failed to log audit event: ${err.message}`));

    this.logger.log(`Successfully sent message ${messageId} via bridge for persona ${personaId}`);
    return updatedMessage;
  }
}
