import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MSchema } from 'mongoose';

@Schema({ _id: false })
export class StyleExample {
  @Prop({ required: true }) input: string;
  @Prop({ required: true }) output: string;
  @Prop({ type: [String], default: [] }) tags: string[];
}

@Schema({ _id: false })
export class ObjectionRule {
  @Prop({ required: true }) trigger: string;
  @Prop({ required: true }) response: string;
  @Prop({ default: 0 }) priority: number;
}

@Schema({ _id: false })
export class LanguagePreferences {
  @Prop({ default: 'en' }) primary: string;
  @Prop({ default: 'ru' }) secondary: string;
  @Prop({ default: true }) autoDetect: boolean;
}

@Schema({ timestamps: true, collection: 'prompt_profiles' })
export class PromptProfile extends Document {
  @Prop({ type: Types.ObjectId, required: true })
  personaId: Types.ObjectId;

  @Prop({ default: 'v1' })
  version: string;

  @Prop({ default: '' })
  systemPrompt: string;

  @Prop({ type: [String], default: ['warm', 'playful', 'curious'] })
  toneDescriptors: string[];

  @Prop({ type: [StyleExample], default: [] })
  styleExamples: StyleExample[];

  @Prop({ type: [ObjectionRule], default: [] })
  objectionRules: ObjectionRule[];

  @Prop({ type: MSchema.Types.Mixed, default: {} })
  topicGuidelines: Record<string, string>;

  @Prop({ type: LanguagePreferences, default: () => ({}) })
  languagePreferences: LanguagePreferences;

  @Prop({ default: '' })
  safetyInstructions: string;
}

export const PromptProfileSchema = SchemaFactory.createForClass(PromptProfile);
