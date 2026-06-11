import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MSchema } from 'mongoose';

@Schema({ _id: false })
export class MediaMetadata {
  @Prop() fileId: string;
  @Prop() fileSize: number;
  @Prop() mimeType: string;
  @Prop() duration: number;
  @Prop() width: number;
  @Prop() height: number;
  @Prop() stickerEmoji: string;
}

@Schema({ _id: false })
export class MessageReaction {
  @Prop({ required: true }) emoji: string;
  @Prop({ required: true }) fromId: string;
  @Prop({ type: Date }) date: Date;
}

@Schema({ timestamps: true, collection: 'messages' })
export class Message extends Document {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  conversationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  personaId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  candidateId: Types.ObjectId;

  @Prop({ required: true })
  telegramMessageId: number;

  @Prop({ type: String, enum: ['inbound', 'outbound'], required: true })
  direction: string;

  @Prop({ type: MSchema.Types.Mixed })
  rawPayload: Record<string, unknown>;

  @Prop({ default: '' })
  normalizedText: string;

  @Prop({ type: String, default: null })
  mediaType: string | null;

  @Prop({ type: MediaMetadata })
  mediaMetadata: MediaMetadata;

  @Prop({ type: Number, default: null })
  replyToMessageId: number | null;

  @Prop({ type: [MessageReaction], default: [] })
  reactions: MessageReaction[];

  @Prop({ default: false })
  edited: boolean;

  @Prop({ type: Date, default: null })
  editedAt: Date | null;

  @Prop({ default: 1.0 })
  confidence: number;

  @Prop({ type: String, enum: ['safe', 'review', 'blocked'], default: 'safe' })
  safetyStatus: string;

  @Prop({ type: Types.ObjectId, default: null })
  auditEventId: Types.ObjectId | null;

  @Prop({ type: Date, required: true })
  sentAt: Date;

  /** If this is a draft message (not yet sent) */
  @Prop({ default: false })
  isDraft: boolean;

  @Prop({ type: String, default: null })
  draftTone: string | null;

  @Prop({ type: String, default: null })
  mediaCategory: string | null;

  @Prop({ type: String, default: null })
  mediaItemId: string | null;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ conversationId: 1, sentAt: 1 });
MessageSchema.index({ personaId: 1, sentAt: -1 });
MessageSchema.index({ personaId: 1, candidateId: 1, isDraft: 1 });
