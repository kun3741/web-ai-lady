import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation } from './schemas/conversation.schema';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectModel(Conversation.name) private readonly conversationModel: Model<Conversation>,
  ) {}

  async findOrCreate(personaId: string, candidateId: string, chatId = ''): Promise<Conversation> {
    let conv = await this.conversationModel
      .findOne({
        personaId: new Types.ObjectId(personaId),
        candidateId: new Types.ObjectId(candidateId),
      })
      .exec();
    if (!conv) {
      conv = await this.conversationModel.create({
        personaId: new Types.ObjectId(personaId),
        candidateId: new Types.ObjectId(candidateId),
        telegramChatId: chatId,
      });
      this.logger.log(`Created conversation for persona=${personaId} candidate=${candidateId}`);
    }
    return conv;
  }

  async findById(id: string): Promise<Conversation | null> {
    return this.conversationModel.findById(id).exec();
  }

  async updateStats(id: string, messageCount: number, lastMessageAt: Date): Promise<void> {
    await this.conversationModel
      .findByIdAndUpdate(id, {
        $inc: { messageCount },
        $set: { lastMessageAt },
      })
      .exec();
  }

  async setLanguage(id: string, language: string): Promise<void> {
    await this.conversationModel.findByIdAndUpdate(id, { language }).exec();
  }

  async findByPersona(personaId: string): Promise<Conversation[]> {
    return this.conversationModel
      .find({ personaId: new Types.ObjectId(personaId) })
      .sort({ lastMessageAt: -1 })
      .exec();
  }
}
