import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MSchema } from 'mongoose';

@Schema({ _id: false })
export class ImportStats {
  @Prop({ default: 0 }) totalMessages: number;
  @Prop({ default: 0 }) imported: number;
  @Prop({ default: 0 }) skipped: number;
  @Prop({ default: 0 }) errors: number;
}

@Schema({ timestamps: true, collection: 'import_jobs' })
export class ImportJob extends Document {
  @Prop({ type: Types.ObjectId, required: true })
  workspaceId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  personaId: Types.ObjectId;

  @Prop({ default: 'telegram_json' })
  sourceType: string;

  @Prop({ required: true })
  fileName: string;

  @Prop({ default: '' })
  filePath: string;

  @Prop({ type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' })
  status: string;

  @Prop({ type: ImportStats, default: () => ({}) })
  stats: ImportStats;

  @Prop({ type: [String], default: [] })
  errorLog: string[];

  @Prop({ type: Date }) startedAt: Date;
  @Prop({ type: Date }) completedAt: Date;
}

export const ImportJobSchema = SchemaFactory.createForClass(ImportJob);
