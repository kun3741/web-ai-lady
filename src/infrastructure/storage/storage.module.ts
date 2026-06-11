import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LocalStorageProvider, STORAGE_PROVIDER } from './local-storage.provider';

@Module({
  imports: [ConfigModule],
  providers: [
    LocalStorageProvider,
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService, LocalStorageProvider],
      useFactory: (config: ConfigService, local: LocalStorageProvider) => {
        const driver = config.get('STORAGE_DRIVER', 'local');
        // S3 provider can be added here when needed
        return local;
      },
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
