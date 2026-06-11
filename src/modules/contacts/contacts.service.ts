import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Candidate } from './schemas/candidate.schema';
import { AuditService } from '@modules/audit/audit.service';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    @InjectModel(Candidate.name) private readonly candidateModel: Model<Candidate>,
    private readonly auditService: AuditService,
  ) {}

  async findOrCreate(
    personaId: string,
    telegramUserId: string,
    displayName: string,
  ): Promise<Candidate> {
    let candidate = await this.candidateModel
      .findOne({ personaId: new Types.ObjectId(personaId), telegramUserId })
      .exec();
    if (!candidate) {
      try {
        candidate = await this.candidateModel.create({
          personaId: new Types.ObjectId(personaId),
          telegramUserId,
          displayName,
        });
        this.logger.log(`Created candidate ${displayName} (${telegramUserId})`);
      } catch (err: any) {
        if (err.code === 11000) {
          candidate = await this.candidateModel
            .findOne({ personaId: new Types.ObjectId(personaId), telegramUserId })
            .exec();
          if (!candidate) {
            throw new Error(`Failed to find candidate after duplicate key error`);
          }
        } else {
          throw err;
        }
      }
    }
    return candidate;
  }

  async findById(id: string): Promise<Candidate | null> {
    return this.candidateModel.findById(id).exec();
  }

  async getActiveLeads(personaId: string, page = 1, limit = 10) {
    const filter = { personaId: new Types.ObjectId(personaId), status: 'active' };
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.candidateModel.find(filter).sort({ lastMessageAt: -1 }).skip(skip).limit(limit).exec(),
      this.candidateModel.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getAllLeads(personaId: string, page = 1, limit = 10) {
    const filter = { personaId: new Types.ObjectId(personaId) };
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.candidateModel.find(filter).sort({ lastMessageAt: -1 }).skip(skip).limit(limit).exec(),
      this.candidateModel.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async setStatus(id: string, status: string, workspaceId: string): Promise<Candidate | null> {
    const candidate = await this.candidateModel
      .findByIdAndUpdate(id, { status }, { new: true })
      .exec();
    if (candidate) {
      await this.auditService.log({
        workspaceId,
        personaId: candidate.personaId.toString(),
        candidateId: id,
        action: `candidate.${status}`,
        actor: 'admin',
        details: { status },
      });
    }
    return candidate;
  }

  async updateLastMessage(id: string, direction: 'inbound' | 'outbound'): Promise<void> {
    const update: Record<string, Date> = { lastMessageAt: new Date() };
    if (direction === 'outbound') {
      update.lastContactedByUsAt = new Date();
    }
    await this.candidateModel.findByIdAndUpdate(id, update).exec();
  }

  async setRiskScore(id: string, score: number): Promise<void> {
    await this.candidateModel.findByIdAndUpdate(id, { riskScore: score }).exec();
  }

  async countByPersona(personaId: string): Promise<Record<string, number>> {
    const results = await this.candidateModel
      .aggregate([
        { $match: { personaId: new Types.ObjectId(personaId) } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .exec();
    const counts: Record<string, number> = {};
    for (const r of results) {
      counts[r._id] = r.count;
    }
    return counts;
  }

  async addSentMediaId(id: string, key: string): Promise<void> {
    await this.candidateModel
      .findByIdAndUpdate(id, { $addToSet: { sentContentMessageIds: key } })
      .exec();
  }
}
