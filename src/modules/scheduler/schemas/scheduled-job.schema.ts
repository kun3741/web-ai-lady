import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MSchema } from 'mongoose';

@Schema({ timestamps: true, collection: 'scheduled_jobs' })
export class ScheduledJob extends Document {
  @Prop({ type: Types.ObjectId, required: true })
  personaId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, default: null })
  candidateId: Types.ObjectId | null;

  @Prop({ type: String, enum: ['followup', 'reminder', 'nudge', 'greeting'], required: true })
  type: string;

  @Prop({ type: Date, required: true })
  scheduledAt: Date;

  @Prop({ type: MSchema.Types.Mixed, default: {} })
  payload: Record<string, unknown>;

  @Prop({ type: String, enum: ['pending', 'executed', 'cancelled', 'failed'], default: 'pending' })
  status: string;

  @Prop({ type: Date, default: null })
  executedAt: Date | null;
}

export const ScheduledJobSchema = SchemaFactory.createForClass(ScheduledJob);
ScheduledJobSchema.index({ status: 1, scheduledAt: 1 });
