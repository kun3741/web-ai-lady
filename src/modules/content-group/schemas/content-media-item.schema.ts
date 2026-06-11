import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true, collection: 'content_media_items' })
export class ContentMediaItem extends Document {
  @Prop({ required: true, index: true })
  groupId: string;

  @Prop({ required: true, index: true })
  topicId: number;

  @Prop({ required: true, index: true })
  messageId: number;

  @Prop({ required: true })
  mediaType: 'photo' | 'video' | 'voice' | 'video_note' | 'document';

  @Prop({ default: '' })
  caption: string;

  @Prop({ default: '' })
  filename: string;

  @Prop({ default: '' })
  mimeType: string;

  @Prop({ required: true, index: true })
  category: string;

  /** AI-derived (or caption-derived) description of what this media is about. */
  @Prop({ default: '' })
  description: string;

  /** Keyword tags for topic matching during selection. */
  @Prop({ type: [String], default: [] })
  tags: string[];

  /** Whisper transcript for voice / video notes (used to understand content). */
  @Prop({ default: '' })
  transcript: string;

  /** Whether the AI analysis pipeline has already processed this item. */
  @Prop({ default: false, index: true })
  analyzed: boolean;
}

export const ContentMediaItemSchema = SchemaFactory.createForClass(ContentMediaItem);
ContentMediaItemSchema.index({ groupId: 1, topicId: 1, messageId: 1 }, { unique: true });
