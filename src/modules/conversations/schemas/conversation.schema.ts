import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'conversations' })
export class Conversation extends Document {
  @Prop({ type: Types.ObjectId, required: true })
  personaId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  candidateId: Types.ObjectId;

  @Prop({ default: '' })
  telegramChatId: string;

  @Prop({ default: 'en' })
  language: string;

  @Prop({ default: 0 })
  messageCount: number;

  @Prop({ type: Date })
  lastMessageAt: Date;

  @Prop({ type: String, enum: ['active', 'paused', 'archived'], default: 'active' })
  status: string;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ personaId: 1, candidateId: 1 }, { unique: true });
