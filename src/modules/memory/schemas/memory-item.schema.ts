import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'memory_items' })
export class MemoryItem extends Document {
  @Prop({ type: Types.ObjectId, required: true })
  personaId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  candidateId: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['profile', 'relationship', 'communication', 'operational'],
    required: true,
  })
  category: string;

  @Prop({ required: true })
  key: string;

  @Prop({ required: true })
  value: string;

  @Prop({ default: 1.0 })
  confidence: number;

  @Prop({ type: String, enum: ['imported', 'extracted', 'manual'], default: 'extracted' })
  source: string;

  @Prop({ type: Types.ObjectId, default: null })
  sourceMessageId: Types.ObjectId | null;
}

export const MemoryItemSchema = SchemaFactory.createForClass(MemoryItem);
MemoryItemSchema.index({ personaId: 1, candidateId: 1, category: 1 });
MemoryItemSchema.index({ personaId: 1, candidateId: 1, key: 1 }, { unique: true });
