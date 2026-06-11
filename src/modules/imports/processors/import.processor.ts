import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Job } from 'bullmq';
import * as fs from 'fs';
import { QUEUE_NAMES } from '@infrastructure/queues/queues.module';
import { ImportJob } from '../schemas/import-job.schema';
import { TelegramJsonParser, ParsedMessage } from '../parsers/telegram-json.parser';
import { ContactsService } from '@modules/contacts/contacts.service';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { MessagesService } from '@modules/messages/messages.service';
import { FunnelService } from '@modules/funnel/funnel.service';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';
import { PromptProfile } from '@modules/prompting/schemas/prompt-profile.schema';
import { StyleExtractorService, StylePair } from '../extractors/style-extractor.service';

const FALLBACK_ADMIN_FROM_ID = '7404772966';

@Processor(QUEUE_NAMES.IMPORT)
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(
    @InjectModel(ImportJob.name) private readonly importJobModel: Model<ImportJob>,
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
    @InjectModel(PromptProfile.name) private readonly promptProfileModel: Model<PromptProfile>,
    private readonly parser: TelegramJsonParser,
    private readonly styleExtractor: StyleExtractorService,
    private readonly contactsService: ContactsService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly funnelService: FunnelService,
  ) {
    super();
  }

  async process(job: Job<{ importJobId: string; filePath: string }>): Promise<void> {
    const { importJobId, filePath } = job.data;
    this.logger.log(`Processing import job ${importJobId}: ${filePath}`);

    const importJob = await this.importJobModel.findById(importJobId).exec();
    if (!importJob) {
      this.logger.error(`Import job ${importJobId} not found`);
      return;
    }

    try {
      await this.importJobModel.findByIdAndUpdate(importJobId, {
        status: 'processing',
        startedAt: new Date(),
      });

      // 1. Read and parse file
      const content = fs.readFileSync(filePath, 'utf-8');
      const { chat, messages } = this.parser.parse(content);
      const persona = await this.personaModel.findById(importJob.personaId).exec();
      const adminFromIds = this.getAdminFromIds(persona);

      importJob.stats.totalMessages = messages.length;

      // 2. Identify counterpart (non-admin user)
      const counterpart = this.identifyCounterpart(messages, adminFromIds);
      if (!counterpart) {
        throw new Error('Could not identify counterpart in chat export');
      }

      // 3. Create/find candidate
      const candidate = await this.contactsService.findOrCreate(
        importJob.personaId.toString(),
        counterpart.id,
        counterpart.name,
      );

      // 4. Create/find conversation
      const conversation = await this.conversationsService.findOrCreate(
        importJob.personaId.toString(),
        candidate._id.toString(),
        chat.id.toString(),
      );

      // 5. Initialize funnel state
      await this.funnelService.getOrCreate(
        candidate._id.toString(),
        importJob.personaId.toString(),
      );

      // 6. Import messages
      let imported = 0;
      let skipped = 0;

      for (const msg of messages) {
        try {
          if (msg.type === 'service') {
            // Import service messages (phone calls) as metadata
            await this.messagesService.createMessage({
              conversationId: conversation._id as Types.ObjectId,
              personaId: importJob.personaId,
              candidateId: candidate._id as Types.ObjectId,
              telegramMessageId: msg.telegramMessageId,
              direction: this.isAdminMessage(msg.fromId, adminFromIds) ? 'outbound' : 'inbound',
              rawPayload: msg.rawPayload as any,
              normalizedText: msg.action
                ? `[${msg.action}${msg.discardReason ? `: ${msg.discardReason}` : ''}${msg.mediaMetadata.duration ? ` (${msg.mediaMetadata.duration}s)` : ''}]`
                : '',
              mediaType: msg.action || null,
              mediaMetadata: msg.mediaMetadata as any,
              replyToMessageId: msg.replyToMessageId,
              reactions: msg.reactions as any,
              edited: msg.edited,
              editedAt: msg.editedAt,
              sentAt: msg.date,
              isDraft: false,
            } as any);
            imported++;
            continue;
          }

          const direction = this.isAdminMessage(msg.fromId, adminFromIds) ? 'outbound' : 'inbound';

          await this.messagesService.createMessage({
            conversationId: conversation._id as Types.ObjectId,
            personaId: importJob.personaId,
            candidateId: candidate._id as Types.ObjectId,
            telegramMessageId: msg.telegramMessageId,
            direction,
            rawPayload: msg.rawPayload as any,
            normalizedText: msg.normalizedText,
            mediaType: msg.mediaType,
            mediaMetadata: msg.mediaMetadata as any,
            replyToMessageId: msg.replyToMessageId,
            reactions: msg.reactions as any,
            edited: msg.edited,
            editedAt: msg.editedAt,
            sentAt: msg.date,
            isDraft: false,
          } as any);
          imported++;
        } catch (err) {
          skipped++;
          const errMsg = `Message ${msg.telegramMessageId}: ${(err as Error).message}`;
          importJob.errorLog.push(errMsg);
        }
      }

      // 7. Detect conversation language
      const lastMessages = messages
        .filter((m) => !this.isAdminMessage(m.fromId, adminFromIds))
        .slice(-10);
      const combinedText = lastMessages.map((m) => m.normalizedText).join(' ');
      const cyrillicCount = (combinedText.match(/[\u0400-\u04FF]/g) || []).length;
      const language = cyrillicCount > combinedText.length * 0.2 ? 'ru' : 'en';
      await this.conversationsService.setLanguage(conversation._id.toString(), language);

      // 8. Extract reusable few-shot style examples for this persona
      const extractedStylePairs = await this.persistStyleProfile(
        importJob.personaId,
        messages,
        adminFromIds,
      );

      // 9. Update stats
      await this.importJobModel.findByIdAndUpdate(importJobId, {
        status: 'completed',
        completedAt: new Date(),
        'stats.totalMessages': messages.length,
        'stats.imported': imported,
        'stats.skipped': skipped,
        'stats.errors': skipped,
        errorLog: importJob.errorLog,
      });

      this.logger.log(
        `Import completed: ${imported} imported, ${skipped} skipped out of ${messages.length}; style pairs=${extractedStylePairs}`,
      );
    } catch (err) {
      this.logger.error(`Import failed: ${(err as Error).message}`);
      await this.importJobModel.findByIdAndUpdate(importJobId, {
        status: 'failed',
        completedAt: new Date(),
        $push: { errorLog: (err as Error).message },
      });
    }
  }

  private identifyCounterpart(
    messages: ParsedMessage[],
    adminFromIds: Set<string>,
  ): { id: string; name: string } | null {
    for (const msg of messages) {
      if (msg.type === 'message' && msg.fromId && !this.isAdminMessage(msg.fromId, adminFromIds)) {
        return { id: msg.fromId, name: msg.fromName };
      }
    }
    return null;
  }

  private async persistStyleProfile(
    personaId: Types.ObjectId,
    messages: ParsedMessage[],
    adminFromIds: Set<string>,
  ): Promise<number> {
    const stylePairs = this.styleExtractor.extractStylePairs(messages, 200, adminFromIds);
    if (stylePairs.length === 0) {
      return 0;
    }

    const existingProfile = await this.promptProfileModel.findOne({ personaId }).exec();
    const existingPairs = ((existingProfile?.styleExamples || []) as StylePair[]).map((pair) => ({
      input: pair.input,
      output: pair.output,
      tags: pair.tags || [],
    }));

    const merged = this.dedupeStylePairs([...existingPairs, ...stylePairs]).slice(-5000);

    const profile = await this.promptProfileModel
      .findOneAndUpdate(
        { personaId },
        {
          personaId,
          version: 'chat-import-v1',
          toneDescriptors: ['warm', 'playful', 'curious', 'caring'],
          styleExamples: merged,
        },
        { new: true, upsert: true },
      )
      .exec();

    if (profile?._id) {
      await this.personaModel.findByIdAndUpdate(personaId, { promptProfileId: profile._id }).exec();
    }

    return stylePairs.length;
  }

  private dedupeStylePairs(pairs: StylePair[]): StylePair[] {
    const seen = new Set<string>();
    const result: StylePair[] = [];

    for (const pair of pairs) {
      const key = `${pair.input.trim()}|||${pair.output.trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(pair);
    }

    return result;
  }

  private getAdminFromIds(persona: Persona | null): Set<string> {
    return new Set(
      [FALLBACK_ADMIN_FROM_ID, persona?.telegramAccountId]
        .map((id) => this.cleanUserId(id || ''))
        .filter(Boolean),
    );
  }

  private isAdminMessage(fromId: string, adminFromIds: Set<string>): boolean {
    return adminFromIds.has(this.cleanUserId(fromId));
  }

  private cleanUserId(rawId: string): string {
    return (rawId || '').replace(/^user/, '').replace(/^@/, '').trim();
  }
}
