import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ _id: false })
export class WorkspaceSettings {
  @Prop({ default: 'Europe/Kiev' })
  timezone: string;

  @Prop({ default: false })
  globalAutopilotEnabled: boolean;

  @Prop({ default: 0.85 })
  minAutosendConfidence: number;

  @Prop({ default: true })
  neverAutosendMedia: boolean;
}

@Schema({ timestamps: true, collection: 'workspaces' })
export class Workspace extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ type: [String], default: [] })
  adminTelegramIds: string[];

  @Prop({ default: false })
  globalPaused: boolean;

  @Prop({ default: '2183482722' })
  contentGroupId: string;

  @Prop({ type: WorkspaceSettings, default: () => ({}) })
  settings: WorkspaceSettings;
}

export const WorkspaceSchema = SchemaFactory.createForClass(Workspace);
