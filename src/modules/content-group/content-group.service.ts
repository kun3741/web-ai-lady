import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ContentGroupConfig, TopicMapping } from './schemas/content-group-config.schema';
import { ContentMediaItem } from './schemas/content-media-item.schema';
import { Candidate } from '@modules/contacts/schemas/candidate.schema';
import { MtprotoBridgeService } from '@infrastructure/telegram/mtproto-bridge.service';
import { ILLMProvider, LLM_PROVIDER } from '@infrastructure/llm/llm.interface';
import { TranscriptionService } from '@modules/transcription/transcription.service';

/** Default topic→category mapping based on analysis of supergroup 2183482722 */
const DEFAULT_TOPIC_MAP: Record<
  number,
  { category: string; funnelStages: string[]; mature?: boolean }
> = {
  1: { category: 'general', funnelStages: ['intro', 'rapport'] },
  4: { category: 'work', funnelStages: ['intro', 'rapport', 'deepening'] },
  6: { category: 'documents', funnelStages: ['deepening', 'planning'] },
  7: { category: 'finance', funnelStages: ['planning', 'ongoing'] },
  8: { category: 'travel_everyday', funnelStages: ['rapport', 'deepening'] },
  12: { category: 'gifts', funnelStages: ['deepening', 'planning'] },
  13: { category: 'friends', funnelStages: ['intro', 'rapport', 'deepening'] },
  14: { category: 'home', funnelStages: ['rapport', 'deepening'] },
  15: { category: 'playful', funnelStages: ['deepening', 'ongoing'], mature: true },
  31: { category: 'sport', funnelStages: ['intro', 'rapport'] },
  45: { category: 'food', funnelStages: ['intro', 'rapport', 'deepening'] },
  52: { category: 'stories_photo', funnelStages: ['intro', 'rapport', 'deepening'] },
  173: { category: 'travel_docs', funnelStages: ['planning', 'met'] },
  210: { category: 'airplane', funnelStages: ['planning', 'met'] },
  222: { category: 'travel_abroad', funnelStages: ['rapport', 'deepening', 'planning'] },
  424: { category: 'beauty', funnelStages: ['deepening', 'planning'] },
  639: { category: 'culture', funnelStages: ['intro', 'rapport'] },
  669: { category: 'life_stories', funnelStages: ['rapport', 'deepening'] },
  765: { category: 'travel_abroad', funnelStages: ['rapport', 'deepening', 'planning'] },
  859: { category: 'home', funnelStages: ['deepening'] },
  968: { category: 'shopping', funnelStages: ['rapport', 'deepening'] },
  1195: { category: 'events', funnelStages: ['intro', 'rapport'] },
  1588: { category: 'family', funnelStages: ['deepening'] },
  1602: { category: 'pets', funnelStages: ['intro', 'rapport'] },
  2076: { category: 'travel_docs', funnelStages: ['planning'] },
  2109: { category: 'travel_abroad', funnelStages: ['rapport', 'deepening', 'planning'] },
  2408: { category: 'documents', funnelStages: ['planning'] },
  2478: { category: 'travel_prep', funnelStages: ['planning', 'met'] },
  2541: { category: 'life_stories', funnelStages: ['deepening'] },
  3112: { category: 'life_stories', funnelStages: ['deepening'] },
  3165: { category: 'travel_plans', funnelStages: ['planning'] },
  3365: { category: 'work', funnelStages: ['rapport'] },
  3419: { category: 'life_stories', funnelStages: ['deepening'] },
  3569: { category: 'education', funnelStages: ['intro', 'rapport'] },
  3681: { category: 'hobbies', funnelStages: ['intro', 'rapport'] },
  4038: { category: 'exclusive', funnelStages: ['deepening', 'ongoing'] },
  4212: { category: 'hobbies', funnelStages: ['intro', 'rapport'] },
  4523: { category: 'travel_docs', funnelStages: ['planning'] },
  5214: { category: 'relax', funnelStages: ['rapport', 'deepening'] },
  5256: { category: 'life_stories', funnelStages: ['rapport'] },
  6172: { category: 'birthday', funnelStages: ['rapport', 'deepening'] },
  6415: { category: 'education', funnelStages: ['intro', 'rapport'] },
  8173: { category: 'life_stories', funnelStages: ['deepening'] },
  8210: { category: 'work', funnelStages: ['deepening'] },
  8568: { category: 'photoshoot', funnelStages: ['deepening', 'planning'] },
  9233: { category: 'travel_abroad', funnelStages: ['planning'] },
  9874: { category: 'life_stories', funnelStages: ['deepening'] },
  10974: { category: 'stories_video', funnelStages: ['intro', 'rapport', 'deepening'] },
  11775: { category: 'education', funnelStages: ['intro', 'rapport'] },
  12364: { category: 'hobbies', funnelStages: ['intro', 'rapport'] },
  12423: { category: 'life_stories', funnelStages: ['deepening'] },
  12937: { category: 'pets', funnelStages: ['intro', 'rapport'] },
  12963: { category: 'work', funnelStages: ['rapport'] },
  13367: { category: 'culture', funnelStages: ['rapport'] },
  10900: { category: 'general', funnelStages: ['rapport'] },
};

/** Topics that are permanently excluded */
const EXCLUDED_TOPIC_IDS = new Set([3534, 6934]);

export function isLateStage(stage: string): boolean {
  return ['deepening', 'planning', 'ongoing', 'met'].includes(stage);
}

export interface FetchedContent {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  topicTitle: string;
  category: string;
  caption?: string;
  messageId?: number;
  isVoice?: boolean;
  isRoundVideo?: boolean;
}

@Injectable()
export class ContentGroupService {
  private readonly logger = new Logger(ContentGroupService.name);

  constructor(
    @InjectModel(ContentGroupConfig.name) private readonly configModel: Model<ContentGroupConfig>,
    @InjectModel(ContentMediaItem.name) private readonly mediaItemModel: Model<ContentMediaItem>,
    @InjectModel(Candidate.name) private readonly candidateModel: Model<Candidate>,
    private readonly bridge: MtprotoBridgeService,
    @Inject(LLM_PROVIDER) private readonly llm: ILLMProvider,
    private readonly transcription: TranscriptionService,
  ) {}

  /**
   * Get or create config for a group
   */
  async getOrCreateConfig(groupId: string): Promise<ContentGroupConfig> {
    let config = await this.configModel.findOne({ groupId }).exec();
    if (!config) {
      config = await this.configModel.create({ groupId, topicMappings: [] });
    }
    return config;
  }

  /**
   * Sync forum topics from the Telegram supergroup into the database.
   * Uses any connected persona's bridge client.
   */
  async syncTopics(
    groupId: string,
    personaId: string,
  ): Promise<{ synced: number; excluded: number }> {
    const client = this.bridge.getClient(personaId);
    if (!client) {
      throw new Error('Bridge не подключен для этой персоны. Подключите Bridge сначала.');
    }

    const { Api } = await import('telegram/tl');

    const entity = await client.getEntity(BigInt('-100' + groupId) as any);
    if (!entity) {
      throw new Error(`Группа ${groupId} не найдена.`);
    }

    // Fetch all topics with pagination
    const allTopics: any[] = [];
    let offsetDate = 0;
    let offsetId = 0;
    let offsetTopic = 0;

    while (true) {
      const result = await client.invoke(
        new Api.channels.GetForumTopics({
          channel: entity,
          limit: 100,
          offsetDate,
          offsetId,
          offsetTopic,
        }),
      );

      const topics = (result as any).topics || [];
      if (topics.length === 0) break;
      allTopics.push(...topics);

      const lastTopic = topics[topics.length - 1];
      offsetDate = lastTopic.date || 0;
      offsetId = lastTopic.topMessage || 0;
      offsetTopic = lastTopic.id || 0;

      if (topics.length < 100) break;
    }

    // Build topic mappings
    const config = await this.getOrCreateConfig(groupId);
    const existingMap = new Map(config.topicMappings.map((m) => [m.topicId, m]));

    const newMappings: TopicMapping[] = [];
    let excluded = 0;

    for (const topic of allTopics) {
      const topicId = topic.id;
      const title = topic.title || 'General';

      if (EXCLUDED_TOPIC_IDS.has(topicId)) {
        excluded++;
        continue;
      }

      // Preserve existing enable/disable choices
      const existing = existingMap.get(topicId);
      const defaults = DEFAULT_TOPIC_MAP[topicId] || {
        category: 'uncategorized',
        funnelStages: ['rapport', 'deepening'],
      };

      newMappings.push({
        topicId,
        topicTitle: title,
        category: existing?.category || defaults.category,
        funnelStages: existing?.funnelStages || defaults.funnelStages,
        enabled: existing?.enabled ?? true,
        mature: existing?.mature ?? (defaults as any).mature ?? false,
      } as TopicMapping);
    }

    config.topicMappings = newMappings;
    config.lastSyncedAt = new Date();
    await config.save();

    // Index all media files from the topics sequentially
    let indexedMediaCount = 0;
    for (const mapping of newMappings) {
      if (mapping.enabled && mapping.category && mapping.category !== 'uncategorized') {
        try {
          const count = await this.indexMediaForTopic(
            groupId,
            personaId,
            mapping.topicId,
            mapping.category,
          );
          indexedMediaCount += count;
        } catch (err: any) {
          this.logger.error(`Error indexing topic ${mapping.topicId}: ${err.message}`);
        }
      }
    }

    this.logger.log(
      `Synced ${newMappings.length} topics for group ${groupId}, excluded ${excluded}. Indexed ${indexedMediaCount} media items.`,
    );

    // Kick off AI analysis (transcription / vision / tagging) in the background.
    this.analyzeUnindexedMedia(groupId, personaId, 200).catch((err) =>
      this.logger.error(`Background media analysis failed: ${err.message}`),
    );

    return { synced: newMappings.length, excluded };
  }

  /**
   * Fetch a random piece of media content suitable for a funnel stage.
   */
  async fetchContentForStage(
    groupId: string,
    personaId: string,
    funnelStage: string,
    candidateId?: string,
  ): Promise<FetchedContent | null> {
    const config = await this.configModel.findOne({ groupId }).exec();
    if (!config || config.topicMappings.length === 0) return null;

    const eligible = config.topicMappings.filter(
      (t) =>
        t.enabled &&
        t.funnelStages.includes(funnelStage) &&
        (!t.mature || isLateStage(funnelStage)),
    );

    if (eligible.length === 0) return null;

    let excludeIds: string[] = [];
    if (candidateId) {
      const candidate = await this.candidateModel.findById(candidateId).exec();
      if (candidate) {
        excludeIds = (candidate as any).sentContentMessageIds || [];
      }
    }

    const shuffled = [...eligible].sort(() => Math.random() - 0.5);
    for (const topic of shuffled) {
      const content = await this.fetchFromTopic(groupId, personaId, topic, excludeIds);
      if (content) return content;
    }
    return null;
  }

  /**
   * Fetch a random piece of media content from a specific category.
   */
  async fetchContentByCategory(
    groupId: string,
    personaId: string,
    category: string,
    candidateStage?: string,
    candidateId?: string,
  ): Promise<FetchedContent | null> {
    const config = await this.configModel.findOne({ groupId }).exec();
    if (!config || config.topicMappings.length === 0) return null;

    const eligible = config.topicMappings.filter(
      (t) =>
        t.enabled &&
        t.category === category &&
        (!t.mature || (candidateStage && isLateStage(candidateStage))),
    );

    if (eligible.length === 0) return null;

    let excludeIds: string[] = [];
    if (candidateId) {
      const candidate = await this.candidateModel.findById(candidateId).exec();
      if (candidate) {
        excludeIds = (candidate as any).sentContentMessageIds || [];
      }
    }

    const shuffled = [...eligible].sort(() => Math.random() - 0.5);
    for (const topic of shuffled) {
      const content = await this.fetchFromTopic(groupId, personaId, topic, excludeIds);
      if (content) return content;
    }
    return null;
  }

  /**
   * Get all unique categories from enabled topics.
   */
  async getAvailableCategories(groupId: string, candidateStage?: string): Promise<string[]> {
    const config = await this.configModel.findOne({ groupId }).exec();
    if (!config) return [];

    const categories = new Set<string>();
    for (const t of config.topicMappings) {
      if (t.enabled) {
        if (t.mature && (!candidateStage || !isLateStage(candidateStage))) {
          continue;
        }
        categories.add(t.category);
      }
    }
    return Array.from(categories).sort();
  }

  /**
   * Toggle a topic enabled/disabled.
   */
  async setTopicEnabled(groupId: string, topicId: number, enabled: boolean): Promise<void> {
    await this.configModel
      .updateOne(
        { groupId, 'topicMappings.topicId': topicId },
        { $set: { 'topicMappings.$.enabled': enabled } },
      )
      .exec();
  }

  /**
   * Get config for display.
   */
  async getConfig(groupId: string): Promise<ContentGroupConfig | null> {
    return this.configModel.findOne({ groupId }).exec();
  }

  // ─── Private ───

  /**
   * Fetch a random media message from a specific topic in the group.
   */
  private async fetchFromTopic(
    groupId: string,
    personaId: string,
    topic: TopicMapping,
    excludeIds: string[] = [],
  ): Promise<FetchedContent | null> {
    const client = this.bridge.getClient(personaId);
    if (!client) throw new Error('Bridge не подключен.');

    const { Api } = await import('telegram/tl');

    try {
      const entity = await client.getEntity(BigInt('-100' + groupId) as any);

      // Get messages from this topic thread
      const result = await client.invoke(
        new Api.messages.GetReplies({
          peer: entity,
          msgId: topic.topicId,
          offsetId: 0,
          offsetDate: 0,
          addOffset: 0,
          limit: 50,
          maxId: 0,
          minId: 0,
          hash: BigInt(0) as any,
        }),
      );

      const messages = ((result as any).messages || []).filter(
        (m: any) => m.media && (m.media.photo || m.media.document),
      );

      const filtered = messages.filter((m: any) => {
        const key = `${groupId}:${m.id}`;
        return !excludeIds.includes(key);
      });

      if (filtered.length === 0) {
        this.logger.debug(`No new media found in topic "${topic.topicTitle}" (${topic.topicId})`);
        return null;
      }

      // Pick random media message
      const msg = filtered[Math.floor(Math.random() * filtered.length)];
      const caption = msg.message || '';

      // Download the media
      const buffer = (await client.downloadMedia(msg, {})) as Buffer;
      if (!buffer || buffer.length === 0) {
        this.logger.warn(`Failed to download media from topic "${topic.topicTitle}"`);
        return null;
      }

      // Determine file info
      let filename = `content_${Date.now()}`;
      let mimeType = 'application/octet-stream';
      let isVoice = false;
      let isRoundVideo = false;

      if (msg.media.photo) {
        filename += '.jpg';
        mimeType = 'image/jpeg';
      } else if (msg.media.document) {
        const doc = msg.media.document;
        mimeType = doc.mimeType || 'application/octet-stream';
        isVoice = doc.attributes?.some((a: any) => a.voice) || false;
        isRoundVideo = doc.attributes?.some((a: any) => a.roundMessage) || false;

        const ext = isRoundVideo
          ? '.mp4'
          : isVoice
            ? '.ogg'
            : mimeType.includes('video')
              ? '.mp4'
              : mimeType.includes('image')
                ? '.jpg'
                : '';
        filename += ext;
        // Try to get original filename from attributes
        const fileAttr = doc.attributes?.find((a: any) => a.fileName);
        if (fileAttr) filename = fileAttr.fileName;
      }

      return {
        buffer,
        filename,
        mimeType,
        topicTitle: topic.topicTitle,
        category: topic.category,
        caption,
        messageId: msg.id,
        isVoice,
        isRoundVideo,
      };
    } catch (err: any) {
      this.logger.error(`Error fetching from topic "${topic.topicTitle}": ${err.message}`);
      return null;
    }
  }

  /**
   * Index media messages for a specific topic into database
   */
  async indexMediaForTopic(
    groupId: string,
    personaId: string,
    topicId: number,
    category: string,
  ): Promise<number> {
    const client = this.bridge.getClient(personaId);
    if (!client) return 0;

    const { Api } = await import('telegram/tl');

    try {
      const entity = await client.getEntity(BigInt('-100' + groupId) as any);
      const result = await client.invoke(
        new Api.messages.GetReplies({
          peer: entity,
          msgId: topicId,
          offsetId: 0,
          offsetDate: 0,
          addOffset: 0,
          limit: 100, // Index up to 100 media messages
          maxId: 0,
          minId: 0,
          hash: BigInt(0) as any,
        }),
      );

      const messages = ((result as any).messages || []).filter(
        (m: any) => m.media && (m.media.photo || m.media.document),
      );

      let count = 0;
      for (const m of messages) {
        let mediaType: 'photo' | 'video' | 'voice' | 'video_note' | 'document' = 'document';
        let mimeType = 'application/octet-stream';
        let filename = `content_${Date.now()}`;

        if (m.media.photo) {
          mediaType = 'photo';
          mimeType = 'image/jpeg';
          filename += '.jpg';
        } else if (m.media.document) {
          const doc = m.media.document;
          mimeType = doc.mimeType || 'application/octet-stream';

          const isVoice = doc.attributes?.some((a: any) => a.voice);
          const isRoundVideo = doc.attributes?.some((a: any) => a.roundMessage);

          if (isVoice) {
            mediaType = 'voice';
          } else if (isRoundVideo) {
            mediaType = 'video_note';
          } else if (mimeType.includes('video')) {
            mediaType = 'video';
          } else {
            mediaType = 'document';
          }

          const fileAttr = doc.attributes?.find((a: any) => a.fileName);
          if (fileAttr) {
            filename = fileAttr.fileName;
          } else {
            const ext = mediaType === 'video' ? '.mp4' : mediaType === 'voice' ? '.ogg' : '';
            filename += ext;
          }
        }

        const caption = m.message || '';

        // Upsert media item
        await this.mediaItemModel
          .updateOne(
            { groupId, topicId, messageId: m.id },
            {
              $set: {
                mediaType,
                caption,
                filename,
                mimeType,
                category,
              },
            },
            { upsert: true },
          )
          .exec();

        count++;
      }

      return count;
    } catch (err: any) {
      this.logger.error(`Failed to index media for topic ${topicId}: ${err.message}`);
      return 0;
    }
  }

  /**
   * Get available media items for stage that are not already sent
   */
  async getAvailableMediaItems(
    groupId: string,
    funnelStage: string,
    excludeIds: string[],
    prioritizeTypes: Array<'photo' | 'video' | 'voice' | 'video_note'> = [],
  ): Promise<ContentMediaItem[]> {
    const config = await this.configModel.findOne({ groupId }).exec();
    if (!config || config.topicMappings.length === 0) return [];

    const eligibleTopics = config.topicMappings.filter(
      (t) =>
        t.enabled &&
        t.funnelStages.includes(funnelStage) &&
        (!t.mature || isLateStage(funnelStage)),
    );
    if (eligibleTopics.length === 0) return [];

    const topicIds = eligibleTopics.map((t) => t.topicId);

    const items = await this.mediaItemModel
      .find({
        groupId,
        topicId: { $in: topicIds },
      })
      .exec();

    const available = items.filter((item) => {
      const key = `${groupId}:${item.messageId}`;
      return !excludeIds.includes(key);
    });

    // Surface prioritized types (e.g. video_note / voice early in the funnel) first
    // so they aren't lost if the list is large/truncated downstream.
    if (prioritizeTypes.length > 0) {
      const prefer = new Set(prioritizeTypes);
      available.sort((a, b) => {
        const aP = prefer.has(a.mediaType as any) ? 0 : 1;
        const bP = prefer.has(b.mediaType as any) ? 0 : 1;
        return aP - bP;
      });
    }

    return available;
  }

  async getMediaItemById(id: string): Promise<ContentMediaItem | null> {
    return this.mediaItemModel.findById(id).exec();
  }

  async findMediaItemsPaginated(
    groupId: string,
    query: any,
    skip: number,
    limit: number,
  ): Promise<ContentMediaItem[]> {
    return this.mediaItemModel
      .find({ groupId, ...query })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();
  }

  async countMediaItems(groupId: string, query: any): Promise<number> {
    return this.mediaItemModel.countDocuments({ groupId, ...query }).exec();
  }

  async getDistinctCategories(groupId: string): Promise<string[]> {
    return this.mediaItemModel.distinct('category', { groupId }).exec() as Promise<string[]>;
  }

  /**
   * Download specific media item from supergroup topic
   */
  async downloadMediaItem(
    mediaItem: ContentMediaItem,
    personaId: string,
  ): Promise<FetchedContent | null> {
    const client = this.bridge.getClient(personaId);
    if (!client) throw new Error('Bridge не подключен.');

    const { Api } = await import('telegram/tl');

    try {
      const entity = await client.getEntity(BigInt('-100' + mediaItem.groupId) as any);

      const result = await client.invoke(
        new Api.messages.GetReplies({
          peer: entity,
          msgId: mediaItem.topicId,
          offsetId: 0,
          offsetDate: 0,
          addOffset: 0,
          limit: 100,
          maxId: 0,
          minId: 0,
          hash: BigInt(0) as any,
        }),
      );

      const messages = (result as any).messages || [];
      const msg = messages.find((m: any) => m.id === mediaItem.messageId);

      if (!msg || !msg.media) {
        this.logger.warn(
          `Media message ${mediaItem.messageId} not found in topic ${mediaItem.topicId}`,
        );
        return null;
      }

      const buffer = (await client.downloadMedia(msg, {})) as Buffer;
      if (!buffer || buffer.length === 0) {
        return null;
      }

      return {
        buffer,
        filename: mediaItem.filename,
        mimeType: mediaItem.mimeType,
        topicTitle: '',
        category: mediaItem.category,
        caption: msg.message || '',
        messageId: mediaItem.messageId,
        isVoice: mediaItem.mediaType === 'voice',
        isRoundVideo: mediaItem.mediaType === 'video_note',
      };
    } catch (err: any) {
      this.logger.error(`Error downloading media item ${mediaItem.messageId}: ${err.message}`);
      return null;
    }
  }

  // ─── Feature 4: AI content indexing & smart selection ───

  /**
   * Run the AI analysis pipeline over not-yet-analyzed media items:
   *  - voice / video notes → Whisper transcript
   *  - photos → GPT-4o vision description
   *  - all → derive a short description + keyword tags (from caption + transcript + vision)
   * Stores description/tags/transcript on each ContentMediaItem and marks it analyzed.
   */
  async analyzeUnindexedMedia(
    groupId: string,
    personaId: string,
    limit = 30,
  ): Promise<{ analyzed: number; failed: number }> {
    const items = await this.mediaItemModel
      .find({ groupId, analyzed: { $ne: true } })
      .limit(limit)
      .exec();

    let analyzed = 0;
    let failed = 0;

    for (const item of items) {
      try {
        let transcript = item.transcript || '';

        if ((item.mediaType === 'voice' || item.mediaType === 'video_note') && !transcript) {
          const content = await this.downloadMediaItem(item, personaId);
          if (content) {
            transcript = await this.transcription.transcribeBuffer(
              content.buffer,
              content.filename,
            );
          }
        }

        let visionDescription = '';
        if (item.mediaType === 'photo' && !item.caption) {
          const content = await this.downloadMediaItem(item, personaId);
          if (content) {
            visionDescription = await this.describeImage(content.buffer, content.mimeType);
          }
        }

        const description = await this.buildDescription(item, transcript, visionDescription);
        const tags = this.deriveTags(
          `${item.caption} ${transcript} ${visionDescription} ${item.category}`,
        );

        item.transcript = transcript;
        item.description = description;
        item.tags = tags;
        item.analyzed = true;
        await item.save();
        analyzed++;
      } catch (err: any) {
        this.logger.error(`Failed to analyze media item ${item.messageId}: ${err.message}`);
        failed++;
      }
    }

    this.logger.log(
      `AI content analysis for group ${groupId}: ${analyzed} analyzed, ${failed} failed.`,
    );
    return { analyzed, failed };
  }

  /** Describe an image via GPT-4o vision; returns a short Russian description. */
  private async describeImage(buffer: Buffer, mimeType: string): Promise<string> {
    try {
      const base64 = buffer.toString('base64');
      const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${base64}`;
      const { content } = await this.llm.chat({
        messages: [
          {
            role: 'user',
            content:
              'Опиши кратко (одним предложением, по-русски), что изображено на этом фото и для какой темы разговора оно подойдёт. ' +
              `Картинка: ${dataUrl}`,
          },
        ],
        temperature: 0.3,
        maxTokens: 120,
      });
      return (content || '').trim();
    } catch (err: any) {
      this.logger.warn(`Vision description failed: ${err.message}`);
      return '';
    }
  }

  /** Build a short human-readable description from the best available signal. */
  private async buildDescription(
    item: ContentMediaItem,
    transcript: string,
    visionDescription: string,
  ): Promise<string> {
    const caption = (item.caption || '').trim();
    if (caption) return caption;
    if (visionDescription) return visionDescription;
    if (transcript) {
      const trimmed = transcript.trim();
      return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
    }
    return `${item.category} (${item.mediaType})`;
  }

  /** Lowercase keyword tags for simple topic matching. */
  private deriveTags(text: string): string[] {
    const lower = (text || '').toLowerCase();
    const tags = new Set<string>();

    const rules: Array<[RegExp, string]> = [
      [/работ|job|work|офис|business/, 'work'],
      [/путешеств|travel|поездк|trip|отпуск|abroad|загранн?иц/, 'travel'],
      [/еда|food|кафе|рестор|готов|cook|кухн/, 'food'],
      [/спорт|sport|зал|трениров|gym|fitness|йог/, 'sport'],
      [/семь|family|мам|пап|брат|сестр|родител/, 'family'],
      [/животн|pet|кот|кошк|собак|пёс|щен/, 'pets'],
      [/дом|home|квартир|уют/, 'home'],
      [/звон|call|видео|video|созвон/, 'call'],
      [/встреч|meet|свидан/, 'meeting'],
      [/красот|beauty|макияж|маникюр|салон|причёск|прическ/, 'beauty'],
      [/природ|nature|море|пляж|горы|закат|парк/, 'nature'],
      [/праздн|birthday|день рожд|holiday|новый год/, 'celebration'],
      [/учёб|учеб|study|универ|education|школ/, 'education'],
      [/привет|hello|знаком|hi|hey/, 'greeting'],
    ];

    for (const [re, tag] of rules) {
      if (re.test(lower)) tags.add(tag);
    }
    return Array.from(tags);
  }

  /**
   * Smart selection: pick the indexed media item that best matches the current
   * conversation, honouring funnel stage, mature gating, and per-lead no-repeat.
   * Optionally bias toward a specific media type (e.g. 'video_note' / 'voice').
   */
  async selectBestMediaForContext(params: {
    groupId: string;
    funnelStage: string;
    conversationText: string;
    excludeIds: string[];
    preferTypes?: Array<'photo' | 'video' | 'voice' | 'video_note'>;
  }): Promise<ContentMediaItem | null> {
    const { groupId, funnelStage, conversationText, excludeIds, preferTypes } = params;

    const candidates = await this.getAvailableMediaItems(groupId, funnelStage, excludeIds);
    if (candidates.length === 0) return null;

    const wantedTags = new Set(this.deriveTags(conversationText));
    const preferSet = new Set(preferTypes || []);

    let best: ContentMediaItem | null = null;
    let bestScore = -Infinity;

    for (const item of candidates) {
      let score = Math.random() * 0.5; // small jitter to avoid always picking the same

      const itemTags =
        item.tags && item.tags.length
          ? item.tags
          : this.deriveTags(`${item.caption} ${item.category}`);
      for (const t of itemTags) {
        if (wantedTags.has(t)) score += 2.0;
      }

      // Lexical overlap with description/caption
      const desc = `${item.description || ''} ${item.caption || ''}`.toLowerCase();
      const overlap = this.lexicalOverlap(conversationText.toLowerCase(), desc);
      score += overlap * 3.0;

      if (preferSet.size > 0 && preferSet.has(item.mediaType as any)) {
        score += 3.0;
      }

      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }

    return best;
  }

  private lexicalOverlap(a: string, b: string): number {
    const tokensA = new Set(
      a
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
    const tokensB = new Set(
      b
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
    if (tokensA.size === 0 || tokensB.size === 0) return 0;
    let inter = 0;
    for (const t of tokensA) if (tokensB.has(t)) inter++;
    return inter / Math.min(tokensA.size, tokensB.size);
  }
}
