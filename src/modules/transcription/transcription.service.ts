import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Transcript } from './schemas/transcript.schema';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  private readonly client?: OpenAI;

  constructor(
    @InjectModel(Transcript.name) private readonly transcriptModel: Model<Transcript>,
    private readonly config: ConfigService,
  ) {
    const apiKey = config.get<string>('OPENAI_API_KEY', '');
    if (apiKey) {
      this.client = new OpenAI({
        apiKey,
        baseURL: config.get<string>('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
      });
    } else {
      this.logger.warn('OpenAI API Key not configured — Whisper transcription will run in mock mode');
    }
  }

  async transcribe(
    messageId: string | Types.ObjectId,
    audioBuffer: Buffer,
    filename: string,
  ): Promise<Transcript> {
    const messageObjectId = new Types.ObjectId(messageId);

    // Check if transcription already exists
    const existing = await this.transcriptModel.findOne({ messageId: messageObjectId }).exec();
    if (existing) {
      return existing;
    }

    let text = '';
    let language = 'en';
    let duration = 0;
    let confidence = 1.0;

    if (this.client) {
      try {
        const file = await OpenAI.toFile(audioBuffer, filename);
        const response = await this.client.audio.transcriptions.create({
          file,
          model: 'whisper-1',
        });
        text = response.text || '';
        this.logger.log(`Successfully transcribed message ${messageId} via Whisper`);
      } catch (err) {
        this.logger.error(`Whisper transcription failed for message ${messageId}: ${(err as Error).message}`);
        text = '[Transcription failed — Audio message placeholder]';
        confidence = 0.0;
      }
    } else {
      text = '[Mock transcription: Hello, this is a voice message recorded for the virtual assistant!]';
      language = 'en';
      duration = 10;
      confidence = 0.9;
    }

    return this.transcriptModel.create({
      messageId: messageObjectId,
      provider: this.client ? 'openai' : 'mock',
      language,
      text,
      confidence,
      duration,
    });
  }

  async findByMessageId(messageId: string | Types.ObjectId): Promise<Transcript | null> {
    return this.transcriptModel.findOne({ messageId: new Types.ObjectId(messageId) }).exec();
  }
}
