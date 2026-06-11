import { Injectable, Logger } from '@nestjs/common';
import { ParsedMessage } from '../parsers/telegram-json.parser';

const FALLBACK_ADMIN_FROM_ID = '7404772966';

export interface StylePair {
  input: string;
  output: string;
  tags: string[];
}

@Injectable()
export class StyleExtractorService {
  private readonly logger = new Logger(StyleExtractorService.name);

  /** Extract response pairs: counterpart message → admin's reply */
  extractStylePairs(
    messages: ParsedMessage[],
    maxPairs = 50,
    adminFromIds: Iterable<string> = [FALLBACK_ADMIN_FROM_ID],
  ): StylePair[] {
    const pairs: StylePair[] = [];
    const regularMessages = messages.filter((m) => m.type === 'message');
    const adminIds = new Set(
      Array.from(adminFromIds)
        .map((id) => this.cleanUserId(id))
        .filter(Boolean),
    );

    if (adminIds.size === 0) {
      adminIds.add(FALLBACK_ADMIN_FROM_ID);
    }

    for (let i = 1; i < regularMessages.length; i++) {
      const prev = regularMessages[i - 1];
      const curr = regularMessages[i];

      // Look for counterpart → admin response pairs
      if (
        !adminIds.has(this.cleanUserId(prev.fromId)) &&
        adminIds.has(this.cleanUserId(curr.fromId)) &&
        prev.normalizedText.length > 3 &&
        curr.normalizedText.length > 3
      ) {
        const tags = this.detectTags(prev.normalizedText, curr.normalizedText);
        pairs.push({
          input: prev.normalizedText,
          output: curr.normalizedText,
          tags,
        });
      }

      if (pairs.length >= maxPairs) break;
    }

    this.logger.log(`Extracted ${pairs.length} style pairs`);
    return pairs;
  }

  private detectTags(input: string, output: string): string[] {
    const tags: string[] = [];
    const combined = `${input} ${output}`.toLowerCase();

    if (/[\u0400-\u04FF]/.test(combined)) tags.push('russian');
    else tags.push('english');

    if (/\?/.test(input)) tags.push('question');
    if (/photo|фото|pic/.test(combined)) tags.push('photos');
    if (/work|работ/.test(combined)) tags.push('work');
    if (/travel|путешеств|trip/.test(combined)) tags.push('travel');
    if (/call|звон|video|видео/.test(combined)) tags.push('call');
    if (/meet|встреч/.test(combined)) tags.push('meeting');
    if (/❤|🥰|😍|💕/.test(combined)) tags.push('affectionate');
    if (/😂|🤣|😅/.test(combined)) tags.push('humor');

    return tags;
  }

  private cleanUserId(rawId: string): string {
    return (rawId || '').replace(/^user/, '').replace(/^@/, '').trim();
  }
}
