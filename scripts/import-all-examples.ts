import mongoose, { Schema, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

// 1. Manual simple env loader to avoid external dependencies
try {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of envLines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value.trim();
      }
    }
  }
} catch (_) {}

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/virtual-lady';
const DB_NAME = process.env.MONGODB_DB_NAME || 'ai-lady';

// 2. Interfaces
interface TelegramExportMessage {
  id: number;
  type: 'message' | 'service';
  date: string;
  date_unixtime: string;
  from?: string;
  from_id?: string;
  actor?: string;
  actor_id?: string;
  action?: string;
  discard_reason?: string;
  duration_seconds?: number;
  text: string | Array<{ type: string; text: string }>;
  text_entities?: Array<{ type: string; text: string }>;
  reply_to_message_id?: number;
  edited?: string;
  edited_unixtime?: string;
  photo?: string;
  photo_file_size?: number;
  file?: string;
  file_name?: string;
  file_size?: number;
  thumbnail?: string;
  thumbnail_file_size?: number;
  media_type?: string;
  mime_type?: string;
  width?: number;
  height?: number;
  sticker_emoji?: string;
  reactions?: Array<{
    type: string;
    count: number;
    emoji: string;
    recent: Array<{ from: string; from_id: string; date: string }>;
  }>;
}

interface TelegramExportChat {
  name: string;
  type: string;
  id: number;
  messages: TelegramExportMessage[];
}

interface ParsedMessage {
  telegramMessageId: number;
  type: 'message' | 'service';
  date: Date;
  fromName: string;
  fromId: string;
  normalizedText: string;
  mediaType: string | null;
  mediaMetadata: {
    fileId?: string;
    fileSize?: number;
    mimeType?: string;
    duration?: number;
    width?: number;
    height?: number;
    stickerEmoji?: string;
  };
  replyToMessageId: number | null;
  reactions: Array<{ emoji: string; fromId: string; date: Date }>;
  edited: boolean;
  editedAt: Date | null;
  rawPayload: TelegramExportMessage;
  action?: string;
  discardReason?: string;
}

interface StylePair {
  input: string;
  output: string;
  tags: string[];
}

// 3. Helper Functions
function normalizeText(text: unknown): string {
  if (typeof text === 'string') return text;
  if (Array.isArray(text)) {
    return text.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
  }
  return '';
}

function cleanUserId(rawId: string): string {
  return (rawId || '').replace(/^user/, '').replace(/^@/, '').trim();
}

// 4. Parser & Extractor Classes
class TelegramJsonParser {
  parse(fileContent: string): { chat: TelegramExportChat; messages: ParsedMessage[] } {
    const cleanContent = fileContent.replace(/^\uFEFF/, '');
    const chat: TelegramExportChat = JSON.parse(cleanContent);
    const parsed: ParsedMessage[] = [];

    for (const msg of chat.messages) {
      try {
        parsed.push(this.parseMessage(msg));
      } catch (err) {
        // Skip message if parse failed
      }
    }

    return { chat, messages: parsed };
  }

  private parseMessage(msg: TelegramExportMessage): ParsedMessage {
    const isService = msg.type === 'service';
    return {
      telegramMessageId: msg.id,
      type: msg.type as 'message' | 'service',
      date: new Date(msg.date),
      fromName: isService ? (msg.actor || '') : (msg.from || ''),
      fromId: cleanUserId(isService ? (msg.actor_id || '') : (msg.from_id || '')),
      normalizedText: normalizeText(msg.text),
      mediaType: this.detectMediaType(msg),
      mediaMetadata: {
        fileSize: msg.file_size || msg.photo_file_size || undefined,
        mimeType: msg.mime_type || undefined,
        duration: msg.duration_seconds || undefined,
        width: msg.width || undefined,
        height: msg.height || undefined,
        stickerEmoji: msg.sticker_emoji || undefined,
      },
      replyToMessageId: msg.reply_to_message_id || null,
      reactions: this.parseReactions(msg.reactions),
      edited: !!msg.edited,
      editedAt: msg.edited ? new Date(msg.edited) : null,
      rawPayload: msg,
      action: msg.action,
      discardReason: msg.discard_reason,
    };
  }

  private detectMediaType(msg: TelegramExportMessage): string | null {
    if (msg.media_type) return msg.media_type;
    if (msg.photo) return 'photo';
    if (msg.sticker_emoji) return 'sticker';
    return null;
  }

  private parseReactions(
    reactions?: TelegramExportMessage['reactions'],
  ): Array<{ emoji: string; fromId: string; date: Date }> {
    if (!reactions) return [];
    const result: Array<{ emoji: string; fromId: string; date: Date }> = [];
    for (const reaction of reactions) {
      for (const recent of reaction.recent || []) {
        result.push({
          emoji: reaction.emoji,
          fromId: cleanUserId(recent.from_id),
          date: new Date(recent.date),
        });
      }
    }
    return result;
  }
}

class StyleExtractorService {
  extractStylePairs(
    messages: ParsedMessage[],
    maxPairs = 100,
    adminFromIds: string[] = [],
  ): StylePair[] {
    const pairs: StylePair[] = [];
    const regularMessages = messages.filter((m) => m.type === 'message');
    const adminIds = new Set(
      adminFromIds.map((id) => cleanUserId(id)).filter(Boolean),
    );

    for (let i = 1; i < regularMessages.length; i++) {
      const prev = regularMessages[i - 1];
      const curr = regularMessages[i];

      // Look for counterpart -> admin response pairs
      if (
        !adminIds.has(cleanUserId(prev.fromId)) &&
        adminIds.has(cleanUserId(curr.fromId)) &&
        prev.normalizedText.trim().length > 3 &&
        curr.normalizedText.trim().length > 3
      ) {
        const tags = this.detectTags(prev.normalizedText, curr.normalizedText);
        pairs.push({
          input: prev.normalizedText.trim(),
          output: curr.normalizedText.trim(),
          tags,
        });
      }

      if (pairs.length >= maxPairs) break;
    }

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
}

// 5. Main Import Logic
async function main() {
  console.log(`Connecting to MongoDB at ${MONGO_URI} (dbName: ${DB_NAME})...`);
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  console.log('Connected!');

  // Defined Schemas
  const PersonaSchema = new Schema({}, { strict: false, collection: 'personas' });
  const PersonaModel = mongoose.model('Persona', PersonaSchema);

  const PromptProfileSchema = new Schema({}, { strict: false, collection: 'prompt_profiles' });
  const PromptProfileModel = mongoose.model('PromptProfile', PromptProfileSchema);

  // Find active persona or specific persona
  const persona = await PersonaModel.findOne({ status: 'active' }).exec();
  if (!persona) {
    console.error('Error: No active persona found in the database!');
    await mongoose.disconnect();
    process.exit(1);
  }

  const personaId = persona._id;
  const personaName = (persona as any).name;
  const telegramAccountId = (persona as any).telegramAccountId;

  console.log(`Found Active Persona: ${personaName} (ID: ${personaId}, Account: ${telegramAccountId})`);

  // Target admin IDs to check against
  const adminFromIds = [
    '7404772966', // Fallback Di ID
    telegramAccountId
  ].filter(Boolean);

  console.log(`Admin/Girl ID filters: ${JSON.stringify(adminFromIds)}`);

  const parser = new TelegramJsonParser();
  const extractor = new StyleExtractorService();

  const examplesDir = path.resolve(__dirname, '../chat-examples');
  if (!fs.existsSync(examplesDir)) {
    console.error(`Error: Examples directory not found at ${examplesDir}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const files = fs.readdirSync(examplesDir).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} JSON files in ${examplesDir}`);

  let allExtractedPairs: StylePair[] = [];

  for (const file of files) {
    const filePath = path.join(examplesDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const { chat, messages } = parser.parse(content);
      
      console.log(`\nProcessing file: ${file}`);
      console.log(`- Chat Name: "${chat.name}", Type: ${chat.type}, Messages Count: ${messages.length}`);
      
      const pairs = extractor.extractStylePairs(messages, 250, adminFromIds);
      console.log(`- Extracted ${pairs.length} style pairs`);
      
      allExtractedPairs.push(...pairs);
    } catch (err) {
      console.error(`Failed to process file ${file}: ${(err as Error).message}`);
    }
  }

  console.log(`\nTotal raw style pairs extracted: ${allExtractedPairs.length}`);

  // Deduplicate pairs
  const seen = new Set<string>();
  const uniquePairs: StylePair[] = [];
  for (const pair of allExtractedPairs) {
    const key = `${pair.input.trim()}|||${pair.output.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniquePairs.push(pair);
  }

  console.log(`Total unique style pairs: ${uniquePairs.length}`);

  // Keep all style examples (up to 5000)
  const finalPairs = uniquePairs.slice(0, 5000);
  console.log(`Selected ${finalPairs.length} style pairs for the prompt profile.`);

  // Print some examples for verification
  console.log('\n--- Sample Pairs ---');
  finalPairs.slice(0, 5).forEach((p, idx) => {
    console.log(`[Sample ${idx + 1}]`);
    console.log(`  Them: "${p.input}"`);
    console.log(`  You:  "${p.output}"`);
    console.log(`  Tags: ${JSON.stringify(p.tags)}`);
  });
  console.log('--------------------\n');

  // Find or create prompt profile
  console.log('Saving to PromptProfile collection...');
  
  const existingProfile = await PromptProfileModel.findOne({ personaId }).exec();
  
  const profileData = {
    personaId,
    version: 'chat-import-bulk-v1',
    toneDescriptors: ['warm', 'playful', 'curious', 'caring', 'authentic'],
    styleExamples: finalPairs,
    updatedAt: new Date()
  };

  let profile;
  if (existingProfile) {
    profile = await PromptProfileModel.findByIdAndUpdate(
      existingProfile._id,
      { $set: profileData },
      { new: true }
    ).exec();
    console.log(`Updated existing PromptProfile: ${profile?._id}`);
  } else {
    profile = await PromptProfileModel.create({
      ...profileData,
      createdAt: new Date()
    });
    console.log(`Created new PromptProfile: ${profile._id}`);
  }

  // Update Persona to reference PromptProfile
  if (profile?._id) {
    await PersonaModel.findByIdAndUpdate(personaId, {
      $set: { promptProfileId: profile._id }
    }).exec();
    console.log(`Linked Persona ${personaName} to PromptProfile ${profile._id}`);
  }

  console.log('\nBulk style training completed successfully!');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Import script failed:', err);
  process.exit(1);
});
