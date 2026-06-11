import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ _id: false })
export class CandidateProfile {
  @Prop() age: number;
  @Prop() location: string;
  @Prop() occupation: string;
  @Prop({ type: [String], default: [] }) languages: string[];
  @Prop({ type: [String], default: [] }) interests: string[];
}

@Schema({ _id: false })
export class ConsentFlags {
  @Prop({ default: false }) photosShared: boolean;
  @Prop({ default: false }) videoCallDone: boolean;
  @Prop({ default: false }) identityVerified: boolean;
}

@Schema({ timestamps: true, collection: 'candidates' })
export class Candidate extends Document {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  personaId: Types.ObjectId;

  @Prop({ required: true })
  telegramUserId: string;

  @Prop({ required: true })
  displayName: string;

  @Prop({ type: CandidateProfile, default: () => ({}) })
  profile: CandidateProfile;

  @Prop({ type: String, enum: ['active', 'paused', 'archived', 'blocked'], default: 'active' })
  status: string;

  @Prop({ default: 0 })
  riskScore: number;

  @Prop({ default: '' })
  reliabilityNotes: string;

  @Prop({ type: ConsentFlags, default: () => ({}) })
  consentFlags: ConsentFlags;

  @Prop({ type: Types.ObjectId })
  funnelStageId: Types.ObjectId;

  @Prop({ type: Date })
  lastMessageAt: Date;

  @Prop({ type: Date })
  lastContactedByUsAt: Date;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: [String], default: [] })
  sentContentMessageIds: string[];
}

export const CandidateSchema = SchemaFactory.createForClass(Candidate);
CandidateSchema.index({ personaId: 1, status: 1 });
CandidateSchema.index({ personaId: 1, lastMessageAt: -1 });
CandidateSchema.index({ personaId: 1, telegramUserId: 1 }, { unique: true });
