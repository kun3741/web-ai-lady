import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MSchema } from 'mongoose';

@Schema({ timestamps: false, collection: 'audit_events' })
export class AuditEvent extends Document {
  @Prop({ type: Types.ObjectId, required: true })
  workspaceId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, default: null })
  personaId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, default: null })
  candidateId: Types.ObjectId | null;

  @Prop({ required: true })
  action: string;

  @Prop({ type: String, enum: ['admin', 'system', 'ai'], required: true })
  actor: string;

  @Prop({ type: MSchema.Types.Mixed, default: {} })
  details: Record<string, unknown>;

  @Prop({ type: Date, default: () => new Date() })
  timestamp: Date;
}

export const AuditEventSchema = SchemaFactory.createForClass(AuditEvent);
AuditEventSchema.index({ workspaceId: 1, timestamp: -1 });
AuditEventSchema.index({ action: 1, timestamp: -1 });
