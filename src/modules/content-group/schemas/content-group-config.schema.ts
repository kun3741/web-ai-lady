import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ _id: false })
export class TopicMapping {
  @Prop({ required: true })
  topicId: number;

  @Prop({ required: true })
  topicTitle: string;

  @Prop({ required: true })
  category: string;

  @Prop({ type: [String], default: [] })
  funnelStages: string[];

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ default: false })
  mature: boolean;
}

@Schema({ timestamps: true, collection: 'content_group_configs' })
export class ContentGroupConfig extends Document {
  @Prop({ type: String, required: true })
  groupId: string;

  @Prop({ type: [TopicMapping], default: [] })
  topicMappings: TopicMapping[];

  @Prop({ type: Date })
  lastSyncedAt: Date;
}

export const ContentGroupConfigSchema = SchemaFactory.createForClass(ContentGroupConfig);
ContentGroupConfigSchema.index({ groupId: 1 }, { unique: true });
