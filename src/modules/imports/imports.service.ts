import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model, Types } from 'mongoose';
import { Queue } from 'bullmq';
import { ImportJob } from './schemas/import-job.schema';
import { QUEUE_NAMES } from '@infrastructure/queues/queues.module';

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    @InjectModel(ImportJob.name) private readonly importJobModel: Model<ImportJob>,
    @InjectQueue(QUEUE_NAMES.IMPORT) private readonly importQueue: Queue,
  ) {}

  async startImport(
    workspaceId: string,
    personaId: string,
    fileName: string,
    filePath: string,
  ): Promise<ImportJob> {
    const job = await this.importJobModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      personaId: new Types.ObjectId(personaId),
      sourceType: 'telegram_json',
      fileName,
      filePath,
      status: 'pending',
    });

    await this.importQueue.add('process-import', {
      importJobId: job._id.toString(),
      filePath,
    });

    this.logger.log(`Import job ${job._id} created for ${fileName}`);
    return job;
  }

  async getImportStatus(jobId: string): Promise<ImportJob | null> {
    return this.importJobModel.findById(jobId).exec();
  }

  async getRecentImports(workspaceId: string, limit = 10): Promise<ImportJob[]> {
    return this.importJobModel
      .find({ workspaceId: new Types.ObjectId(workspaceId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }
}
