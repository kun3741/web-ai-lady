import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { PromptProfile, PromptProfileSchema } from './schemas/prompt-profile.schema';
import { Persona, PersonaSchema } from '@modules/telegram-accounts/schemas/persona.schema';
import { PromptComposerService } from './prompt-composer.service';
import { ChatExamplesLoaderService } from './chat-examples-loader.service';
import { TelegramJsonParser } from '@modules/imports/parsers/telegram-json.parser';
import { StyleExtractorService } from '@modules/imports/extractors/style-extractor.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: PromptProfile.name, schema: PromptProfileSchema },
      { name: Persona.name, schema: PersonaSchema },
    ]),
  ],
  providers: [
    PromptComposerService,
    ChatExamplesLoaderService,
    TelegramJsonParser,
    StyleExtractorService,
  ],
  exports: [PromptComposerService, ChatExamplesLoaderService, MongooseModule],
})
export class PromptingModule {}
