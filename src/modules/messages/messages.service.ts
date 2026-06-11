import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message } from './schemas/message.schema';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { ContactsService } from '@modules/contacts/contacts.service';

/** Normalize Telegram export text field: can be string or array of {type, text} */
export function normalizeText(text: unknown): string {
  if (typeof text === 'string') return text;
  if (Array.isArray(text)) {
    return text.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
  }
  return '';
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    private readonly conversationsService: ConversationsService,
    private readonly contactsService: ContactsService,
  ) {}

  async createMessage(data: Partial<Message>): Promise<Message> {
    const msg = await this.messageModel.create(data as any);

    // Update conversation stats
    if (data.conversationId) {
      await this.conversationsService.updateStats(
        data.conversationId.toString(),
        1,
        data.sentAt || new Date(),
      );
    }

    // Update candidate last message time
    if (data.candidateId && data.direction) {
      await this.contactsService.updateLastMessage(
        data.candidateId.toString(),
        data.direction as 'inbound' | 'outbound',
      );
    }

    return msg;
  }

  async getRecentMessages(
    personaId: string,
    candidateId: string,
    limit = 20,
  ): Promise<Message[]> {
    return this.messageModel
      .find({
        personaId: new Types.ObjectId(personaId),
        candidateId: new Types.ObjectId(candidateId),
        isDraft: false,
      })
      .sort({ sentAt: -1 })
      .limit(limit)
      .exec()
      .then((msgs) => msgs.reverse());
  }

  async getDrafts(personaId: string, candidateId: string): Promise<Message[]> {
    return this.messageModel
      .find({
        personaId: new Types.ObjectId(personaId),
        candidateId: new Types.ObjectId(candidateId),
        isDraft: true,
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  async getPendingDrafts(personaId: string): Promise<Message[]> {
    return this.messageModel
      .find({ personaId: new Types.ObjectId(personaId), isDraft: true })
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();
  }

  async approveDraft(draftId: string): Promise<Message | null> {
    return this.messageModel
      .findByIdAndUpdate(draftId, { isDraft: false, direction: 'outbound' }, { new: true })
      .exec();
  }

  async deleteDraft(draftId: string): Promise<void> {
    await this.messageModel.findByIdAndDelete(draftId).exec();
  }

  async updateDraftText(draftId: string, text: string, tone?: string): Promise<Message | null> {
    const update: Record<string, unknown> = { normalizedText: text };
    if (tone) update.draftTone = tone;
    return this.messageModel.findByIdAndUpdate(draftId, update, { new: true }).exec();
  }

  async findById(id: string): Promise<Message | null> {
    return this.messageModel.findById(id).exec();
  }

  async countByConversation(conversationId: string): Promise<number> {
    return this.messageModel.countDocuments({ conversationId: new Types.ObjectId(conversationId) }).exec();
  }

  async getLastInboundMessage(personaId: string, candidateId: string): Promise<Message | null> {
    return this.messageModel
      .findOne({
        personaId: new Types.ObjectId(personaId),
        candidateId: new Types.ObjectId(candidateId),
        direction: 'inbound',
        isDraft: false,
      })
      .sort({ sentAt: -1 })
      .exec();
  }
}
