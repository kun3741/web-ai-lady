import { Injectable } from '@nestjs/common';

export interface SafetyResult {
  blocked: boolean;
  flagged: boolean;
  reasons: string[];
}

/** Financial/exploitative patterns that must be blocked */
const BLOCK_PATTERNS = [
  /send\s+(me\s+)?money/i,
  /отправь\s+(мне\s+)?деньги/i,
  /transfer\s+funds/i,
  /перевед[иь]\s+(мне\s+)?деньг/i,
  /wire\s+me/i,
  /western\s+union/i,
  /bitcoin|crypto\s+wallet/i,
  /gift\s*card/i,
  /пополн[ить]\s+сч[её]т/i,
  /нужны\s+деньги/i,
];

/** Sensitive topics requiring manual review */
const FLAG_PATTERNS = [
  { pattern: /money|деньг|dollar|евро|euro|\$|€/i, reason: 'Financial topic detected' },
  { pattern: /ticket|билет|flight|рейс|перел[её]т/i, reason: 'Travel/ticket topic detected' },
  { pattern: /passport|паспорт|visa|виза/i, reason: 'Document/visa topic detected' },
  { pattern: /meet\s+at|встретимся|hotel|отел[ьи]/i, reason: 'Meeting logistics detected' },
  { pattern: /luggage|чемодан|pack|собира/i, reason: 'Travel preparation topic' },
];

@Injectable()
export class SafetyEvaluatorService {
  evaluate(text: string): SafetyResult {
    if (!text) return { blocked: false, flagged: false, reasons: [] };

    // Check for blocked patterns
    for (const pattern of BLOCK_PATTERNS) {
      if (pattern.test(text)) {
        return {
          blocked: true,
          flagged: true,
          reasons: [`Blocked: Financial solicitation detected — "${text.substring(0, 100)}..."`],
        };
      }
    }

    // Check for flagged patterns
    const reasons: string[] = [];
    for (const { pattern, reason } of FLAG_PATTERNS) {
      if (pattern.test(text)) {
        reasons.push(reason);
      }
    }

    return {
      blocked: false,
      flagged: reasons.length > 0,
      reasons,
    };
  }
}
