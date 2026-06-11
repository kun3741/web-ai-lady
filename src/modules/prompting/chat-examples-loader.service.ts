import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { PromptProfile } from './schemas/prompt-profile.schema';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';
import { TelegramJsonParser } from '@modules/imports/parsers/telegram-json.parser';
import { StyleExtractorService } from '@modules/imports/extractors/style-extractor.service';

/** Default Telegram user id of the "girl"/admin side in the example exports. */
const DEFAULT_ADMIN_FROM_ID = '7404772966';

/**
 * Feature 2: On startup, parse the repo's chat-examples/ folder and seed the
 * extracted dialogue pairs into the active persona's PromptProfile.styleExamples,
 * so the bot replies in a similar style. Runtime retrieval of the most relevant
 * examples for an incoming message happens in ContextAssemblerService.
 *
 * Controlled by env LOAD_CHAT_EXAMPLES (default: only seed when the profile has
 * no styleExamples yet, to avoid clobbering a manually curated profile).
 */
@Injectable()
export class ChatExamplesLoaderService implements OnModuleInit {
  private readonly logger = new Logger(ChatExamplesLoaderService.name);
  private readonly parser = new TelegramJsonParser();
  private readonly extractor = new StyleExtractorService();

  constructor(
    @InjectModel(PromptProfile.name) private readonly promptProfileModel: Model<PromptProfile>,
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const mode = this.config.get<string>('LOAD_CHAT_EXAMPLES', 'auto');
    if (mode === 'off') {
      this.logger.log('Chat-examples loading disabled (LOAD_CHAT_EXAMPLES=off)');
      return;
    }

    try {
      await this.loadAndSeed(mode === 'force');
    } catch (err: any) {
      // Never block app startup on example loading.
      this.logger.error(`Chat-examples loading failed: ${err.message}`);
    }
  }

  /**
   * Parse all chat-examples JSON files and seed styleExamples into prompt profiles.
   * @param force overwrite existing styleExamples even if already populated.
   */
  async loadAndSeed(force = false): Promise<{ pairs: number; profilesUpdated: number }> {
    const dir = this.resolveExamplesDir();
    if (!dir) {
      this.logger.warn('chat-examples directory not found — skipping style seeding');
      return { pairs: 0, profilesUpdated: 0 };
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      this.logger.warn(`No JSON files in ${dir}`);
      return { pairs: 0, profilesUpdated: 0 };
    }

    const personas = await this.personaModel.find({ status: 'active' }).exec();
    if (personas.length === 0) {
      this.logger.log('No active personas — skipping chat-examples seeding for now');
      return { pairs: 0, profilesUpdated: 0 };
    }

    const adminIds = new Set<string>([DEFAULT_ADMIN_FROM_ID]);
    for (const p of personas) {
      if (p.telegramAccountId) adminIds.add(p.telegramAccountId);
    }

    const seen = new Set<string>();
    const allPairs: Array<{ input: string; output: string; tags: string[] }> = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const { messages } = this.parser.parse(content);
        const pairs = this.extractor.extractStylePairs(messages, 250, adminIds);
        for (const pair of pairs) {
          const key = `${pair.input.trim()}|||${pair.output.trim()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          allPairs.push(pair);
        }
      } catch (err: any) {
        this.logger.warn(`Failed to parse ${file}: ${err.message}`);
      }
    }

    if (allPairs.length === 0) {
      this.logger.warn('No style pairs extracted from chat-examples');
      return { pairs: 0, profilesUpdated: 0 };
    }

    const finalPairs = allPairs.slice(0, 5000);
    this.logger.log(
      `Extracted ${finalPairs.length} unique style pairs from ${files.length} example files`,
    );

    let profilesUpdated = 0;
    for (const persona of personas) {
      let profile: PromptProfile | null = null;
      if (persona.promptProfileId) {
        profile = await this.promptProfileModel.findById(persona.promptProfileId).exec();
      }

      if (!profile) {
        profile = await this.promptProfileModel.create({
          personaId: persona._id,
          version: 'chat-examples-auto-v1',
          styleExamples: finalPairs,
        });
        await this.personaModel
          .updateOne({ _id: persona._id }, { $set: { promptProfileId: profile._id } })
          .exec();
        profilesUpdated++;
        this.logger.log(
          `Created PromptProfile for persona ${persona.name} with ${finalPairs.length} examples`,
        );
        continue;
      }

      const hasExamples = (profile.styleExamples?.length || 0) > 0;
      if (hasExamples && !force) {
        this.logger.log(
          `Persona ${persona.name} already has ${profile.styleExamples.length} style examples — skipping (set LOAD_CHAT_EXAMPLES=force to overwrite)`,
        );
        continue;
      }

      profile.styleExamples = finalPairs as any;
      await profile.save();
      profilesUpdated++;
      this.logger.log(
        `Seeded ${finalPairs.length} style examples into persona ${persona.name}'s profile`,
      );
    }

    return { pairs: finalPairs.length, profilesUpdated };
  }

  /** Find the chat-examples directory relative to cwd or compiled dist. */
  private resolveExamplesDir(): string | null {
    const candidates = [
      path.resolve(process.cwd(), 'chat-examples'),
      path.resolve(__dirname, '../../../chat-examples'),
      path.resolve(__dirname, '../../../../chat-examples'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }
}
