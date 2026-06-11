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
}

export const ContentMediaItemSchema = SchemaFactory.createForClass(ContentMediaItem);
ContentMediaItemSchema.index({ groupId: 1, topicId: 1, messageId: 1 }, { unique: true });
