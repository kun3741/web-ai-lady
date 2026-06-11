import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MediaAsset } from './schemas/media-asset.schema';
import { STORAGE_PROVIDER, IStorageProvider } from '@infrastructure/storage/local-storage.provider';
import * as crypto from 'crypto';

@Injectable()
export class MediaLibraryService {
  private readonly logger = new Logger(MediaLibraryService.name);

  constructor(
    @InjectModel(MediaAsset.name) private readonly mediaAssetModel: Model<MediaAsset>,
    @Inject(STORAGE_PROVIDER) private readonly storageProvider: IStorageProvider,
  ) {}

  async upload(
    personaId: string | Types.ObjectId,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    type: 'photo' | 'video' | 'voice' | 'document',
    tags: string[] = [],
    stageAllowlist: string[] = [],
    metadata: { width?: number; height?: number; duration?: number } = {},
  ): Promise<MediaAsset> {
    const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // De-duplication check per persona
    const existing = await this.mediaAssetModel.findOne({
      personaId: new Types.ObjectId(personaId),
      checksum,
    }).exec();

    if (existing) {
      this.logger.log(`Media asset with checksum ${checksum} already exists, returning existing`);
      return existing;
    }

    const fileExt = file.originalname.split('.').pop() || '';
    const key = `${personaId}/${type}/${checksum}.${fileExt}`;
    await this.storageProvider.put(key, file.buffer, file.mimetype);

    return this.mediaAssetModel.create({
      personaId: new Types.ObjectId(personaId),
      type,
      storageKey: key,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.buffer.length,
      checksum,
      tags,
      stageAllowlist,
      manualOnly: true, // Default to true for safety
      metadata,
    });
  }

  async findCompatible(
    personaId: string | Types.ObjectId,
    stage: string,
    tags: string[] = [],
  ): Promise<MediaAsset[]> {
    const query: any = {
      personaId: new Types.ObjectId(personaId),
      manualOnly: false, // only automatic allowed if calling findCompatible
    };

    if (stage) {
      query.stageAllowlist = stage;
    }

    if (tags && tags.length > 0) {
      query.tags = { $in: tags };
    }

    return this.mediaAssetModel.find(query).exec();
  }

  async getReviewQueue(personaId?: string | Types.ObjectId): Promise<MediaAsset[]> {
    const query: any = { manualOnly: true };
    if (personaId) {
      query.personaId = new Types.ObjectId(personaId);
    }
    return this.mediaAssetModel.find(query).exec();
  }

  async markAutoAllowed(id: string | Types.ObjectId): Promise<MediaAsset | null> {
    return this.mediaAssetModel.findByIdAndUpdate(id, { manualOnly: false }, { new: true }).exec();
  }

  async markManualOnly(id: string | Types.ObjectId): Promise<MediaAsset | null> {
    return this.mediaAssetModel.findByIdAndUpdate(id, { manualOnly: true }, { new: true }).exec();
  }

  async findById(id: string | Types.ObjectId): Promise<MediaAsset | null> {
    return this.mediaAssetModel.findById(id).exec();
  }

  async findAll(personaId?: string | Types.ObjectId): Promise<MediaAsset[]> {
    const query: any = {};
    if (personaId) {
      query.personaId = new Types.ObjectId(personaId);
    }
    return this.mediaAssetModel.find(query).exec();
  }
}
