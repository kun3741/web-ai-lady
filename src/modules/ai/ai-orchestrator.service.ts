import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Candidate } from '@modules/contacts/schemas/candidate.schema';
import { ILLMProvider, LLM_PROVIDER } from '@infrastructure/llm/llm.interface';
import { ContextAssemblerService, AssembledContext } from './services/context-assembler.service';
import { SafetyEvaluatorService, SafetyResult } from './services/safety-evaluator.service';
import { ConfidenceScorerService } from './services/confidence-scorer.service';
import { LanguageDetectorService } from './services/language-detector.service';
import { PromptComposerService } from '@modules/prompting/prompt-composer.service';
import { SettingsService } from '@modules/settings/settings.service';
import { ContentGroupService } from '@modules/content-group/content-group.service';
import { z } from 'zod';

/** Schema for AI draft response validation */
const DraftResponseSchema = z.object({
  reply: z.string().min(1),
  tone: z.string().optional(),
  language: z.string().optional(),
  reasoning: z.string().optional(),
  suggestedFollowUp: z.string().optional(),
  mediaCategory: z.string().nullable().optional(),
  attachedMediaId: z.string().nullable().optional(),
});

type DraftResponse = z.infer<typeof DraftResponseSchema>;

export interface DraftResult {
  text: string;
  tone: string;
  language: string;
  confidence: number;
  safety: SafetyResult;
  reasoning: string;
  suggestedFollowUp?: string;
  mediaCategory?: string | null;
  attachedMediaId?: string | null;
}

export type RewriteStyle = 'cooler' | 'warmer' | 'shorter' | 'more_direct' | 'small_talk' | 'to_call' | 'to_tickets' | 'to_luggage' | 'to_meeting';

@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: ILLMProvider,
    private readonly contextAssembler: ContextAssemblerService,
    private readonly safetyEvaluator: SafetyEvaluatorService,
    private readonly confidenceScorer: ConfidenceScorerService,
    private readonly languageDetector: LanguageDetectorService,
    private readonly promptComposer: PromptComposerService,
    private readonly settingsService: SettingsService,
    private readonly contentGroupService: ContentGroupService,
    @InjectModel(Candidate.name) private readonly candidateModel: Model<Candidate>,
  ) {}

  async generateDraft(personaId: string, candidateId: string): Promise<DraftResult> {
    // 1. Assemble context (strictly isolated to this persona+candidate)
    const context = await this.contextAssembler.assemble(personaId, candidateId);

    // 2. Detect language from recent messages
    const language = await this.languageDetector.detect(context.recentMessages);

    // 3. Safety pre-check on inbound message
    const lastInbound = context.recentMessages
      .filter((m) => m.direction === 'inbound')
      .pop();
    const preSafety = this.safetyEvaluator.evaluate(lastInbound?.normalizedText || '');

    if (preSafety.blocked) {
      return {
        text: '[BLOCKED: Content flagged for safety review]',
        tone: 'neutral',
        language,
        confidence: 0,
        safety: preSafety,
        reasoning: preSafety.reasons.join('; '),
      };
    }

    // 4. Compose prompt
    const ws = await this.settingsService.getOrCreateDefault();
    const groupId = ws.contentGroupId || '2183482722';

    let excludeIds: string[] = [];
    const candidate = await this.candidateModel.findById(candidateId).exec();
    if (candidate) {
      excludeIds = (candidate as any).sentContentMessageIds || [];
    }

    const availableMediaItems = await this.contentGroupService.getAvailableMediaItems(groupId, context.funnelStage, excludeIds);

    const systemPrompt = this.promptComposer.composeSystemPrompt(context, language, availableMediaItems);
    const userPrompt = this.promptComposer.composeDraftPrompt(context, language);

    // 5. Generate via LLM with structured JSON
    const { data, raw } = await this.llm.json<DraftResponse>({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
    });

    // 6. Validate with zod
    const parsed = DraftResponseSchema.safeParse(data);
    if (!parsed.success) {
      this.logger.error('AI response validation failed', parsed.error.errors);
      return {
        text: data.reply || '[Error: Invalid AI response]',
        tone: 'neutral',
        language,
        confidence: 0.3,
        safety: { blocked: false, flagged: true, reasons: ['Invalid AI response format'] },
        reasoning: 'Response failed schema validation',
      };
    }

    // 7. Safety post-check on generated content
    const postSafety = this.safetyEvaluator.evaluate(parsed.data.reply);

    // 8. Score confidence
    const confidence = this.confidenceScorer.score({
      contextDepth: context.memoryContext.length,
      topicSensitivity: postSafety.flagged ? 0.3 : 1.0,
      messageComplexity: (lastInbound?.normalizedText || '').length > 200 ? 0.7 : 1.0,
      funnelStage: context.funnelStage,
    });

    return {
      text: parsed.data.reply,
      tone: parsed.data.tone || 'warm',
      language: parsed.data.language || language,
      confidence,
      safety: postSafety,
      reasoning: parsed.data.reasoning || '',
      suggestedFollowUp: parsed.data.suggestedFollowUp,
      mediaCategory: parsed.data.mediaCategory || null,
      attachedMediaId: parsed.data.attachedMediaId || null,
    };
  }

  async rewriteDraft(
    currentText: string,
    style: RewriteStyle,
    personaId: string,
    candidateId: string,
  ): Promise<DraftResult> {
    const context = await this.contextAssembler.assemble(personaId, candidateId);
    const language = await this.languageDetector.detect(context.recentMessages);

    const styleInstructions: Record<RewriteStyle, string> = {
      cooler: 'Make the tone cooler, more reserved, less emotional. Keep it polite but distant.',
      warmer: 'Make the tone warmer, more affectionate and caring. Add emotional warmth.',
      shorter: 'Make the reply much shorter and more concise. Keep the core message.',
      more_direct: 'Make the reply more direct and to the point. Remove filler.',
      small_talk: 'Redirect to casual small talk. Ask about their day, weather, food, etc.',
      to_call: 'Gently suggest or move towards scheduling a video/phone call.',
      to_tickets: 'Carefully bring up travel logistics. DO NOT ask for money or tickets directly.',
      to_luggage: 'Mention preparation for meeting/travel. DO NOT solicit gifts or funds.',
      to_meeting: 'Steer conversation towards planning an in-person meeting.',
    };

    const { data } = await this.llm.json<DraftResponse>({
      messages: [
        {
          role: 'system',
          content: `You are a conversation copilot. Rewrite the given message with this style instruction: ${styleInstructions[style]}
Language: ${language}. Keep the message natural and authentic. Respond in JSON: { "reply": "...", "tone": "...", "language": "...", "reasoning": "..." }`,
        },
        {
          role: 'user',
          content: `Original message to rewrite:\n"${currentText}"\n\nContext: Funnel stage is "${context.funnelStage}".`,
        },
      ],
      temperature: 0.6,
    });

    const safety = this.safetyEvaluator.evaluate(data.reply || currentText);

    return {
      text: data.reply || currentText,
      tone: data.tone || style,
      language: data.language || language,
      confidence: safety.blocked ? 0 : 0.8,
      safety,
      reasoning: data.reasoning || '',
    };
  }
}
