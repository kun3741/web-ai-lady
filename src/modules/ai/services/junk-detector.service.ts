import { Injectable } from '@nestjs/common';
import { Message } from '@modules/messages/schemas/message.schema';

export interface JunkSignal {
  /** Whether the recent inbound activity looks like spam / nonsense / repeats */
  isJunk: boolean;
  /** Escalation level: 0 = none, 1 = first offence (playful tease), 2+ = firm boundary */
  level: number;
  /** Machine-readable reasons, e.g. 'repeat', 'gibberish', 'digits' */
  reasons: string[];
}

/**
 * Detects low-effort / junk inbound behaviour so the bot can react like a real
 * person instead of replying sweetly as if nothing happened. Handles:
 *  - exact / near-duplicate repeated messages ("привет" / "привет")
 *  - digit-only or code-like strings (e.g. "123456", "x9f2k1")
 *  - meaningless gibberish (random letters, no vowels, keyboard mashing)
 */
@Injectable()
export class JunkDetectorService {
  /** How many of the most recent inbound messages to consider */
  private static readonly WINDOW = 5;

  analyze(recentMessages: Message[]): JunkSignal {
    const inbound = recentMessages
      .filter((m) => m.direction === 'inbound' && !m.mediaType)
      .slice(-JunkDetectorService.WINDOW);

    if (inbound.length === 0) {
      return { isJunk: false, level: 0, reasons: [] };
    }

    const last = inbound[inbound.length - 1];
    const lastText = (last.normalizedText || '').trim();

    // Empty / media-only last message is not junk in this sense
    if (!lastText) {
      return { isJunk: false, level: 0, reasons: [] };
    }

    const reasons = new Set<string>();
    let junkCount = 0;

    // 1) Repeated identical / near-identical messages in a row
    const normalizedTexts = inbound.map((m) => this.normalize(m.normalizedText || ''));
    const lastNorm = this.normalize(lastText);
    let consecutiveRepeats = 0;
    for (let i = normalizedTexts.length - 1; i >= 0; i--) {
      if (normalizedTexts[i] && this.isNearDuplicate(normalizedTexts[i], lastNorm)) {
        consecutiveRepeats++;
      } else {
        break;
      }
    }
    if (consecutiveRepeats >= 2) {
      reasons.add('repeat');
      junkCount += consecutiveRepeats - 1;
    }

    // 1.5) Repeated greetings in a row (e.g. "hi", then "hello", then "hey")
    let consecutiveGreetings = 0;
    for (let i = inbound.length - 1; i >= 0; i--) {
      const text = (inbound[i].normalizedText || '').trim();
      if (text && this.isGreetingOnly(text)) {
        consecutiveGreetings++;
      } else {
        break;
      }
    }
    if (consecutiveGreetings >= 2) {
      reasons.add('repeat');
      junkCount += consecutiveGreetings - 1;
    }

    // 2) Per-message junk classification across the window
    for (const text of inbound.map((m) => (m.normalizedText || '').trim())) {
      if (!text) continue;
      if (this.isDigitsOrCode(text)) {
        reasons.add('digits');
        junkCount++;
      } else if (this.isGibberish(text)) {
        reasons.add('gibberish');
        junkCount++;
      }
    }

    // The last message itself must be junk OR a repeat to trigger a reaction —
    // otherwise a single old junk message shouldn't make the bot rude.
    const lastIsJunk =
      this.isDigitsOrCode(lastText) ||
      this.isGibberish(lastText) ||
      consecutiveRepeats >= 2 ||
      consecutiveGreetings >= 2;

    if (!lastIsJunk || reasons.size === 0) {
      return { isJunk: false, level: 0, reasons: [] };
    }

    // Escalation: 1st junk hit = playful tease; 2-3+ = firm boundary
    const level = junkCount >= 2 ? 2 : 1;

    return { isJunk: true, level, reasons: Array.from(reasons) };
  }

  private normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '')
      .trim();
  }

  private isNearDuplicate(a: string, b: string): boolean {
    if (!a || !b) return false;
    if (a === b) return true;
    // Very short strings: require exact match to avoid false positives
    if (a.length <= 3 || b.length <= 3) return a === b;
    // Levenshtein-lite: treat as duplicate if one contains the other and lengths are close
    if (a.includes(b) || b.includes(a)) {
      return Math.abs(a.length - b.length) <= 2;
    }
    return false;
  }

  private isDigitsOrCode(text: string): boolean {
    const stripped = text.replace(/\s+/g, '');
    if (stripped.length < 3) return false;
    // Pure digits (codes, phone-ish, random numbers)
    if (/^\d{3,}$/.test(stripped)) return true;
    // Code-like: mix of letters+digits with no spaces and no real words (e.g. "x9f2k1", "ab12cd34")
    const hasDigit = /\d/.test(stripped);
    const hasLetter = /[a-zа-яё]/i.test(stripped);
    if (hasDigit && hasLetter && !stripped.includes(' ') && stripped.length <= 16) {
      const digitRatio = (stripped.match(/\d/g) || []).length / stripped.length;
      if (digitRatio >= 0.3) return true;
    }
    return false;
  }

  private isGibberish(text: string): boolean {
    const cleaned = text.replace(/[^\p{L}]/gu, '');
    if (cleaned.length < 6) return false;
    // Multiple words usually means real (even if low effort) — only flag single token mashes
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 1) return false;

    const lower = cleaned.toLowerCase();
    const vowels = (lower.match(/[aeiouаеёиоуыэюя]/g) || []).length;
    const vowelRatio = vowels / lower.length;
    // Almost no vowels → keyboard mash / gibberish
    if (vowelRatio < 0.12) return true;
    // Long run of the same character (e.g. "ааааааа", "ggggggg")
    if (/(.)\1{4,}/.test(lower)) return true;
    return false;
  }

  private isGreetingOnly(text: string): boolean {
    const norm = text
      .toLowerCase()
      .replace(/[^\p{L}\s]/gu, '') // Keep letters and spaces, remove punctuation/emojis
      .trim();
    if (!norm) return false;

    const greetingRegex =
      /^(hi(ya|ii+|\sthere)?|hello(\sthere)?|hey+y*|hola|yo|привет(ик|ики)?|привіт(ик)?|хай|хелл?о|ку|здравствуй(те)?|здарова?|добрый\s+день|добрый\s+вечер|доброе\s+утро|добрий\s+день|добрий\s+вечір|доброго\s+ранку)$/i;

    return greetingRegex.test(norm);
  }
}
