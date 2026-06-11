import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MessagesService } from '@modules/messages/messages.service';
import { MemoryService } from '@modules/memory/memory.service';
import { FunnelService } from '@modules/funnel/funnel.service';
import { PromptProfile } from '@modules/prompting/schemas/prompt-profile.schema';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';
import { Message } from '@modules/messages/schemas/message.schema';
import { JunkDetectorService, JunkSignal } from './junk-detector.service';

export interface AssembledContext {
  persona: Persona | null;
  promptProfile: PromptProfile | null;
  recentMessages: Message[];
  memoryContext: string;
  funnelStage: string;
  funnelObjective: string;
  styleExamples: Array<{ input: string; output: string }>;
  junkSignal: JunkSignal;
  outboundCount: number;
}

@Injectable()
export class ContextAssemblerService {
  private readonly logger = new Logger(ContextAssemblerService.name);

  constructor(
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
    @InjectModel(PromptProfile.name) private readonly promptProfileModel: Model<PromptProfile>,
    private readonly messagesService: MessagesService,
    private readonly memoryService: MemoryService,
    private readonly funnelService: FunnelService,
    private readonly junkDetector: JunkDetectorService,
  ) {}

  /** Assemble full context for AI — strictly scoped to personaId + candidateId */
  async assemble(personaId: string, candidateId: string): Promise<AssembledContext> {
    // All queries are scoped to this specific persona+candidate pair
    const [persona, recentMessages, memoryContext, funnelState] = await Promise.all([
      this.personaModel.findById(personaId).exec(),
      this.messagesService.getRecentMessages(personaId, candidateId, 20),
      this.memoryService.formatMemoryForPrompt(personaId, candidateId),
      this.funnelService.getOrCreate(candidateId, personaId),
    ]);

    let promptProfile: PromptProfile | null = null;
    if (persona?.promptProfileId) {
      promptProfile = await this.promptProfileModel.findById(persona.promptProfileId).exec();
    }

    const styleExamples = promptProfile?.styleExamples || [];
    let selectedExamples = styleExamples;

    if (styleExamples.length > 0) {
      const lastInbound = recentMessages
        .slice()
        .reverse()
        .find((m) => m.direction === 'inbound');

      const candidateText = lastInbound?.normalizedText || '';
      const lastMediaType = lastInbound?.mediaType || null;

      const scoredExamples = styleExamples.map((example) => {
        const score = calculateExampleScore(candidateText, lastMediaType, example);
        return { example, score };
      });

      // Sort by score descending
      scoredExamples.sort((a, b) => b.score - a.score);
      selectedExamples = scoredExamples.slice(0, 12).map((item) => item.example);
    }

    const junkSignal = this.junkDetector.analyze(recentMessages);
    const outboundCount = recentMessages.filter((m) => m.direction === 'outbound').length;

    return {
      persona,
      promptProfile,
      recentMessages,
      memoryContext,
      funnelStage: funnelState.stage,
      funnelObjective: funnelState.objective,
      styleExamples: selectedExamples.map((e) => ({ input: e.input, output: e.output })),
      junkSignal,
      outboundCount,
    };
  }
}

function calculateSimilarity(text1: string, text2: string): number {
  const tokens1 = new Set(
    text1
      .toLowerCase()
      .replace(/[^\w\s\u0400-\u04FF]/g, '')
      .split(/\s+/)
      .filter(Boolean),
  );
  const tokens2 = new Set(
    text2
      .toLowerCase()
      .replace(/[^\w\s\u0400-\u04FF]/g, '')
      .split(/\s+/)
      .filter(Boolean),
  );

  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  let intersectionSize = 0;
  for (const token of tokens1) {
    if (tokens2.has(token)) {
      intersectionSize++;
    }
  }

  const unionSize = tokens1.size + tokens2.size - intersectionSize;
  return intersectionSize / unionSize;
}

function calculateExampleScore(
  candidateText: string,
  lastMediaType: string | null,
  example: any,
): number {
  let score = 0;

  // 1. Text Similarity (Jaccard)
  const textSim = calculateSimilarity(candidateText, example.input);
  score += textSim * 5.0; // Higher weight for actual text similarity

  // 2. Language Matching
  const isCyrillic = /[\u0400-\u04FF]/.test(candidateText);
  const exampleIsRussian = example.tags?.includes('russian');
  if (isCyrillic && exampleIsRussian) {
    score += 1.0;
  } else if (!isCyrillic && !exampleIsRussian && example.tags?.includes('english')) {
    score += 1.0;
  }

  // 3. Question Matching
  const isQuestion = candidateText.includes('?');
  const exampleIsQuestion = example.tags?.includes('question');
  if (isQuestion && exampleIsQuestion) {
    score += 0.8;
  }

  // 4. Media/Photo Matching
  if (lastMediaType === 'photo' && example.tags?.includes('photos')) {
    score += 1.5;
  }

  // 5. Keyword Topic Matching
  const lowerCand = candidateText.toLowerCase();

  if (/work|job|работ|зан?.т/.test(lowerCand) && example.tags?.includes('work')) {
    score += 1.2;
  }
  if (/travel|trip|поездок|путешеств|отпуск/.test(lowerCand) && example.tags?.includes('travel')) {
    score += 1.2;
  }
  if (/call|звон|video|видео/.test(lowerCand) && example.tags?.includes('call')) {
    score += 1.2;
  }
  if (/meet|встреч|свидан/.test(lowerCand) && example.tags?.includes('meeting')) {
    score += 1.2;
  }
  if (
    /❤|🥰|😍|💕|😘|love|любл|милая|солн/.test(lowerCand) &&
    example.tags?.includes('affectionate')
  ) {
    score += 1.0;
  }
  if (/😂|🤣|😅|хаха|haha|lol|смеш/.test(lowerCand) && example.tags?.includes('humor')) {
    score += 1.0;
  }

  return score;
}
