import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PromptProfile, PromptProfileSchema } from './schemas/prompt-profile.schema';
import { PromptComposerService } from './prompt-composer.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: PromptProfile.name, schema: PromptProfileSchema }]),
  ],
  providers: [PromptComposerService],
  exports: [PromptComposerService, MongooseModule],
})
export class PromptingModule {}
