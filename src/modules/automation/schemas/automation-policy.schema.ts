import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'automation_policies' })
export class AutomationPolicy extends Document {
  @Prop({ type: String, enum: ['workspace', 'persona', 'candidate'], required: true })
  scope: string;

  @Prop({ type: Types.ObjectId, required: true })
  scopeId: Types.ObjectId;

  @Prop({ type: String, enum: ['draft', 'assisted', 'full', 'paused'], default: 'draft' })
  mode: string;

  @Prop({ default: 0.85 })
  minConfidenceForAutosend: number;

  @Prop({ default: true })
  neverAutosendMedia: boolean;

  @Prop({ type: [String], default: ['money', 'travel', 'meeting'] })
  requireApprovalForTopics: string[];

  @Prop({ default: 10 })
  maxAutosendsPerHour: number;
}

export const AutomationPolicySchema = SchemaFactory.createForClass(AutomationPolicy);
AutomationPolicySchema.index({ scope: 1, scopeId: 1 }, { unique: true });
