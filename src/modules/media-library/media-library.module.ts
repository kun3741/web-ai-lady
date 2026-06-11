import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaAsset, MediaAssetSchema } from './schemas/media-asset.schema';
import { MediaLibraryService } from './media-library.service';
import { StorageModule } from '@infrastructure/storage/storage.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: MediaAsset.name, schema: MediaAssetSchema }]),
    StorageModule,
  ],
  providers: [MediaLibraryService],
  exports: [MediaLibraryService],
})
export class MediaLibraryModule {}
