import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'transcripts' })
export class Transcript extends Document {
  @Prop({ type: Types.ObjectId, required: true })
  messageId: Types.ObjectId;

  @Prop({ default: 'openai' })
  provider: string;

  @Prop({ default: '' })
  language: string;

  @Prop({ default: '' })
  text: string;

  @Prop({ default: 0 })
  confidence: number;

  @Prop({ default: 0 })
  duration: number;
}

export const TranscriptSchema = SchemaFactory.createForClass(Transcript);
TranscriptSchema.index({ messageId: 1 });
