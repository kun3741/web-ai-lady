import { Injectable } from '@nestjs/common';

interface ScoringFactors {
  contextDepth: number; // number of memory items
  topicSensitivity: number; // 0-1, lower = more sensitive
  messageComplexity: number; // 0-1, lower = more complex
  funnelStage: string;
}

const STAGE_CONFIDENCE_MODIFIER: Record<string, number> = {
  new: 0.7,
  intro: 0.8,
  rapport: 0.9,
  deepening: 0.85,
  planning: 0.6, // lower because planning involves sensitive logistics
  met: 0.9,
  ongoing: 0.95,
  cooled: 0.7,
  archived: 0.5,
};

@Injectable()
export class ConfidenceScorerService {
  score(factors: ScoringFactors): number {
    const contextScore = Math.min(factors.contextDepth / 10, 1.0); // max at 10 memory items
    const stageModifier = STAGE_CONFIDENCE_MODIFIER[factors.funnelStage] ?? 0.7;

    const raw =
      contextScore * 0.3 +
      factors.topicSensitivity * 0.3 +
      factors.messageComplexity * 0.2 +
      stageModifier * 0.2;

    return Math.round(Math.min(Math.max(raw, 0), 1) * 100) / 100;
  }
}
