import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ _id: false })
export class QuietHours {
  @Prop({ default: '23:00' })
  start: string;

  @Prop({ default: '08:00' })
  end: string;

  @Prop({ default: 'Europe/Kiev' })
  timezone: string;
}

@Schema({ timestamps: true, collection: 'personas' })
export class Persona extends Document {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  workspaceId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  telegramAccountId: string;

  @Prop({ type: Types.ObjectId })
  promptProfileId: Types.ObjectId;

  @Prop({ default: '' })
  mediaLibraryTag: string;

  @Prop({ default: '' })
  biography: string;

  @Prop({ default: '' })
  phone: string;

  @Prop({ default: '' })
  whatsApp: string;

  @Prop({ default: '' })
  paymentDetails: string;

  @Prop({ default: '' })
  legend: string;

  @Prop({ default: '' })
  paymentRules: string;

  @Prop({ type: QuietHours, default: () => ({}) })
  quietHours: QuietHours;

  @Prop({ type: String, enum: ['active', 'paused', 'archived'], default: 'active' })
  status: string;

  // ─── MTProto Bridge fields ───

  /** AES-encrypted GramJS StringSession */
  @Prop({ default: '' })
  mtprotoSessionEncrypted: string;

  /** Telegram API credentials from my.telegram.org */
  @Prop({ type: Number, default: 0 })
  mtprotoApiId: number;

  @Prop({ default: '' })
  mtprotoApiHash: string;

  /** Whether the MTProto client is currently connected */
  @Prop({ default: false })
  mtprotoConnected: boolean;

  /** Phone number used for MTProto authorization */
  @Prop({ default: '' })
  mtprotoPhone: string;

  /** Content supergroup ID */
  @Prop({ default: '2183482722' })
  contentGroupId: string;
}

export const PersonaSchema = SchemaFactory.createForClass(Persona);
PersonaSchema.index({ workspaceId: 1, status: 1 });
