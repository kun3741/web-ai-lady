import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Workspace } from './schemas/workspace.schema';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(@InjectModel(Workspace.name) private readonly workspaceModel: Model<Workspace>) {}

  async getOrCreateDefault(): Promise<Workspace> {
    let ws = await this.workspaceModel.findOne().exec();
    if (!ws) {
      ws = await this.workspaceModel.create({
        name: 'Default Workspace',
        adminTelegramIds: [],
        globalPaused: false,
      });
      this.logger.log('Created default workspace');
    }
    return ws;
  }

  async getWorkspace(): Promise<Workspace | null> {
    return this.workspaceModel.findOne().exec();
  }

  async setGlobalPause(paused: boolean): Promise<Workspace | null> {
    return this.workspaceModel.findOneAndUpdate({}, { globalPaused: paused }, { new: true }).exec();
  }

  async addAdmin(telegramId: string): Promise<Workspace | null> {
    return this.workspaceModel
      .findOneAndUpdate({}, { $addToSet: { adminTelegramIds: telegramId } }, { new: true })
      .exec();
  }

  async isAdmin(telegramId: string): Promise<boolean> {
    const ws = await this.getWorkspace();
    if (!ws) return false;
    return ws.adminTelegramIds.includes(telegramId);
  }

  async updateContentGroupId(groupId: string): Promise<Workspace | null> {
    return this.workspaceModel.findOneAndUpdate({}, { contentGroupId: groupId }, { new: true }).exec();
  }
}
