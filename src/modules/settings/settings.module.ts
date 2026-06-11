import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Workspace, WorkspaceSchema } from './schemas/workspace.schema';
import { SettingsService } from './settings.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Workspace.name, schema: WorkspaceSchema }])],
  providers: [SettingsService],
  exports: [SettingsService, MongooseModule],
})
export class SettingsModule {}
