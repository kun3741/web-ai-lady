import { Injectable, Logger } from '@nestjs/common';
import { Message } from '@modules/messages/schemas/message.schema';

@Injectable()
export class LanguageDetectorService {
  private readonly logger = new Logger(LanguageDetectorService.name);

  /** Detect primary language from recent messages using simple heuristics */
  async detect(messages: Message[]): Promise<string> {
    const inboundTexts = messages
      .filter((m) => m.direction === 'inbound' && m.normalizedText)
      .map((m) => m.normalizedText)
      .slice(-5);

    if (inboundTexts.length === 0) return 'en';

    const combined = inboundTexts.join(' ');
    const cyrillicCount = (combined.match(/[\u0400-\u04FF]/g) || []).length;
    const latinCount = (combined.match(/[a-zA-Z]/g) || []).length;

    if (cyrillicCount > latinCount * 0.5) return 'ru';
    return 'en';
  }
}
