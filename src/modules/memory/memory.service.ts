import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MemoryItem } from './schemas/memory-item.schema';
import { ILLMProvider, LLM_PROVIDER } from '@infrastructure/llm/llm.interface';

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    @InjectModel(MemoryItem.name) private readonly memoryModel: Model<MemoryItem>,
    @Inject(LLM_PROVIDER) private readonly llm: ILLMProvider,
  ) {}

  async upsertMemory(params: {
    personaId: string;
    candidateId: string;
    category: string;
    key: string;
    value: string;
    confidence?: number;
    source?: string;
    sourceMessageId?: string;
  }): Promise<MemoryItem> {
    return this.memoryModel
      .findOneAndUpdate(
        {
          personaId: new Types.ObjectId(params.personaId),
          candidateId: new Types.ObjectId(params.candidateId),
          key: params.key,
        },
        {
          $set: {
            category: params.category,
            value: params.value,
            confidence: params.confidence ?? 1.0,
            source: params.source ?? 'extracted',
            sourceMessageId: params.sourceMessageId
              ? new Types.ObjectId(params.sourceMessageId)
              : null,
          },
          $setOnInsert: {
            personaId: new Types.ObjectId(params.personaId),
            candidateId: new Types.ObjectId(params.candidateId),
            key: params.key,
          },
        },
        { upsert: true, new: true },
      )
      .exec() as Promise<MemoryItem>;
  }

  async getContextForCandidate(
    personaId: string,
    candidateId: string,
  ): Promise<Record<string, MemoryItem[]>> {
    const items = await this.memoryModel
      .find({
        personaId: new Types.ObjectId(personaId),
        candidateId: new Types.ObjectId(candidateId),
      })
      .sort({ category: 1, key: 1 })
      .exec();

    const grouped: Record<string, MemoryItem[]> = {};
    for (const item of items) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }
    return grouped;
  }

  async extractFromMessage(
    personaId: string,
    candidateId: string,
    messageText: string,
    messageId?: string,
  ): Promise<void> {
    if (!messageText || messageText.length < 5) return;

    try {
      const { data } = await this.llm.json<{
        facts: Array<{ category: string; key: string; value: string; confidence: number }>;
      }>({
        messages: [
          {
            role: 'system',
            content: `You are a memory extraction assistant. Extract key facts from the message.
Categories: profile (age, location, occupation, etc.), relationship (feelings, interests), communication (language pref, response style), operational (schedule, availability).
Return JSON: { "facts": [{ "category": "...", "key": "...", "value": "...", "confidence": 0.0-1.0 }] }
Only extract clear, explicit facts. Do not infer or assume.`,
          },
          { role: 'user', content: messageText },
        ],
        temperature: 0.2,
      });

      if (data.facts && Array.isArray(data.facts)) {
        for (const fact of data.facts) {
          if (fact.confidence >= 0.6) {
            await this.upsertMemory({
              personaId,
              candidateId,
              category: fact.category,
              key: fact.key,
              value: fact.value,
              confidence: fact.confidence,
              source: 'extracted',
              sourceMessageId: messageId,
            });
          }
        }
        this.logger.debug(`Extracted ${data.facts.length} facts from message`);
      }
    } catch (err) {
      this.logger.error('Memory extraction failed', (err as Error).message);
    }
  }

  async formatMemoryForPrompt(personaId: string, candidateId: string): Promise<string> {
    const grouped = await this.getContextForCandidate(personaId, candidateId);
    const lines: string[] = [];

    for (const [category, items] of Object.entries(grouped)) {
      lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}`);
      for (const item of items) {
        lines.push(`- ${item.key}: ${item.value}`);
      }
    }

    return lines.join('\n') || 'No known facts about this contact yet.';
  }
}
