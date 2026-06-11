import { Injectable, Logger } from '@nestjs/common';
import { normalizeText } from '@modules/messages/messages.service';

/** Telegram JSON export message shape (as discovered from real exports) */
export interface TelegramExportMessage {
  id: number;
  type: 'message' | 'service';
  date: string;
  date_unixtime: string;
  from?: string;
  from_id?: string;
  actor?: string;
  actor_id?: string;
  action?: string;
  discard_reason?: string;
  duration_seconds?: number;
  text: string | Array<{ type: string; text: string }>;
  text_entities?: Array<{ type: string; text: string }>;
  reply_to_message_id?: number;
  edited?: string;
  edited_unixtime?: string;
  photo?: string;
  photo_file_size?: number;
  file?: string;
  file_name?: string;
  file_size?: number;
  thumbnail?: string;
  thumbnail_file_size?: number;
  media_type?: string;
  mime_type?: string;
  width?: number;
  height?: number;
  sticker_emoji?: string;
  reactions?: Array<{
    type: string;
    count: number;
    emoji: string;
    recent: Array<{ from: string; from_id: string; date: string }>;
  }>;
}

export interface TelegramExportChat {
  name: string;
  type: string;
  id: number;
  messages: TelegramExportMessage[];
}

export interface ParsedMessage {
  telegramMessageId: number;
  type: 'message' | 'service';
  date: Date;
  fromName: string;
  fromId: string;
  normalizedText: string;
  mediaType: string | null;
  mediaMetadata: {
    fileId?: string;
    fileSize?: number;
    mimeType?: string;
    duration?: number;
    width?: number;
    height?: number;
    stickerEmoji?: string;
  };
  replyToMessageId: number | null;
  reactions: Array<{ emoji: string; fromId: string; date: Date }>;
  edited: boolean;
  editedAt: Date | null;
  rawPayload: TelegramExportMessage;
  // Service-specific
  action?: string;
  discardReason?: string;
}

@Injectable()
export class TelegramJsonParser {
  private readonly logger = new Logger(TelegramJsonParser.name);

  parse(fileContent: string): { chat: TelegramExportChat; messages: ParsedMessage[] } {
    // Handle UTF-8 BOM
    const cleanContent = fileContent.replace(/^\uFEFF/, '');
    const chat: TelegramExportChat = JSON.parse(cleanContent);

    this.logger.log(`Parsing chat "${chat.name}" — ${chat.messages.length} raw messages`);

    const parsed: ParsedMessage[] = [];

    for (const msg of chat.messages) {
      try {
        parsed.push(this.parseMessage(msg));
      } catch (err) {
        this.logger.warn(`Failed to parse message ${msg.id}: ${(err as Error).message}`);
      }
    }

    return { chat, messages: parsed };
  }

  private parseMessage(msg: TelegramExportMessage): ParsedMessage {
    const isService = msg.type === 'service';

    return {
      telegramMessageId: msg.id,
      type: msg.type as 'message' | 'service',
      date: new Date(msg.date),
      fromName: isService ? msg.actor || '' : msg.from || '',
      fromId: this.cleanUserId(isService ? msg.actor_id || '' : msg.from_id || ''),
      normalizedText: normalizeText(msg.text),
      mediaType: this.detectMediaType(msg),
      mediaMetadata: {
        fileSize: msg.file_size || msg.photo_file_size || undefined,
        mimeType: msg.mime_type || undefined,
        duration: msg.duration_seconds || undefined,
        width: msg.width || undefined,
        height: msg.height || undefined,
        stickerEmoji: msg.sticker_emoji || undefined,
      },
      replyToMessageId: msg.reply_to_message_id || null,
      reactions: this.parseReactions(msg.reactions),
      edited: !!msg.edited,
      editedAt: msg.edited ? new Date(msg.edited) : null,
      rawPayload: msg,
      action: msg.action,
      discardReason: msg.discard_reason,
    };
  }

  private detectMediaType(msg: TelegramExportMessage): string | null {
    if (msg.media_type) return msg.media_type;
    if (msg.photo) return 'photo';
    if (msg.sticker_emoji) return 'sticker';
    return null;
  }

  private parseReactions(
    reactions?: TelegramExportMessage['reactions'],
  ): Array<{ emoji: string; fromId: string; date: Date }> {
    if (!reactions) return [];
    const result: Array<{ emoji: string; fromId: string; date: Date }> = [];
    for (const reaction of reactions) {
      for (const recent of reaction.recent || []) {
        result.push({
          emoji: reaction.emoji,
          fromId: this.cleanUserId(recent.from_id),
          date: new Date(recent.date),
        });
      }
    }
    return result;
  }

  private cleanUserId(rawId: string): string {
    return rawId.replace(/^user/, '');
  }
}
