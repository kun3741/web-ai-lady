import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MSchema } from 'mongoose';

@Schema({ _id: false })
export class AssetMetadata {
  @Prop() width: number;
  @Prop() height: number;
  @Prop() duration: number;
  @Prop() thumbnail: string;
}

@Schema({ timestamps: true, collection: 'media_assets' })
export class MediaAsset extends Document {
  @Prop({ type: Types.ObjectId, required: true })
  personaId: Types.ObjectId;

  @Prop({ type: String, enum: ['photo', 'video', 'voice', 'document'], required: true })
  type: string;

  @Prop({ required: true })
  storageKey: string;

  @Prop({ default: '' })
  originalFilename: string;

  @Prop({ default: '' })
  mimeType: string;

  @Prop({ default: 0 })
  fileSize: number;

  @Prop({ required: true })
  checksum: string;

  @Prop({ default: '' })
  fingerprint: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: [String], default: [] })
  stageAllowlist: string[];

  @Prop({ default: true })
  manualOnly: boolean;

  @Prop({ type: AssetMetadata })
  metadata: AssetMetadata;

  @Prop({ type: Date, default: () => new Date() })
  uploadedAt: Date;
}

export const MediaAssetSchema = SchemaFactory.createForClass(MediaAsset);
MediaAssetSchema.index({ personaId: 1, checksum: 1 });
MediaAssetSchema.index({ personaId: 1, tags: 1 });
