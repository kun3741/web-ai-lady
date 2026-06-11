import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transcript, TranscriptSchema } from './schemas/transcript.schema';
import { TranscriptionService } from './transcription.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Transcript.name, schema: TranscriptSchema }]),
    ConfigModule,
  ],
  providers: [TranscriptionService],
  exports: [TranscriptionService],
})
export class TranscriptionModule {}
