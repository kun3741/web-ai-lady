import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI', 'mongodb://localhost:27017/virtual-lady'),
        dbName: config.get<string>('MONGODB_DB_NAME', 'virtual-lady'),
        autoIndex: true,
        connectTimeoutMS: 10000,
        serverSelectionTimeoutMS: 5000,
      }),
    }),
  ],
})
export class DatabaseModule {}
