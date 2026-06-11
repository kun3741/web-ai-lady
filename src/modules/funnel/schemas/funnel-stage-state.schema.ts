import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ _id: false })
export class FunnelFlags {
  @Prop({ default: false }) videoCallCompleted: boolean;
  @Prop({ default: false }) photosExchanged: boolean;
  @Prop({ default: false }) travelDiscussed: boolean;
  @Prop({ default: false }) meetingPlanned: boolean;
}

@Schema({ _id: false })
export class FunnelTransition {
  @Prop({ required: true }) from: string;
  @Prop({ required: true }) to: string;
  @Prop({ default: '' }) reason: string;
  @Prop({ type: String, enum: ['admin', 'system', 'ai'], default: 'admin' }) triggeredBy: string;
  @Prop({ type: Date, default: () => new Date() }) at: Date;
}

export const FUNNEL_STAGES = [
  'new',
  'intro',
  'rapport',
  'deepening',
  'planning',
  'met',
  'ongoing',
  'cooled',
  'archived',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

@Schema({ timestamps: true, collection: 'funnel_stage_states' })
export class FunnelStageState extends Document {
  @Prop({ type: Types.ObjectId, required: true, unique: true })
  candidateId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  personaId: Types.ObjectId;

  @Prop({ type: String, enum: FUNNEL_STAGES, default: 'new' })
  stage: FunnelStage;

  @Prop({ type: FunnelFlags, default: () => ({}) })
  flags: FunnelFlags;

  @Prop({ default: '' })
  objective: string;

  @Prop({ type: [FunnelTransition], default: [] })
  transitionHistory: FunnelTransition[];

  @Prop({ type: Date, default: () => new Date() })
  enteredAt: Date;
}

export const FunnelStageStateSchema = SchemaFactory.createForClass(FunnelStageState);
FunnelStageStateSchema.index({ candidateId: 1 }, { unique: true });
FunnelStageStateSchema.index({ personaId: 1, stage: 1 });
