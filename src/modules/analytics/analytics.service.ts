import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Candidate } from '../contacts/schemas/candidate.schema';
import { Message } from '../messages/schemas/message.schema';
import { FunnelStageState } from '../funnel/schemas/funnel-stage-state.schema';
import { AuditEvent } from '../audit/schemas/audit-event.schema';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectModel(Candidate.name) private readonly candidateModel: Model<Candidate>,
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    @InjectModel(FunnelStageState.name) private readonly funnelModel: Model<FunnelStageState>,
    @InjectModel(AuditEvent.name) private readonly auditModel: Model<AuditEvent>,
  ) {}

  async getOverviewStats(personaId?: string | Types.ObjectId): Promise<any> {
    const filter: any = {};
    if (personaId) {
      filter.personaId = new Types.ObjectId(personaId);
    }

    // 1. Leads by status
    const statusCounts = await this.candidateModel.aggregate([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).exec();

    const leadsByStatus = { active: 0, paused: 0, archived: 0, blocked: 0 };
    for (const group of statusCounts) {
      if (group._id in leadsByStatus) {
        leadsByStatus[group._id as keyof typeof leadsByStatus] = group.count;
      }
    }

    // 2. Funnel stage distribution
    const funnelCounts = await this.funnelModel.aggregate([
      { $match: filter },
      { $group: { _id: '$stage', count: { $sum: 1 } } },
    ]).exec();

    const funnelDistribution: Record<string, number> = {};
    for (const group of funnelCounts) {
      funnelDistribution[group._id] = group.count;
    }

    // 3. Message counts
    const messageFilter: any = { isDraft: false };
    if (personaId) {
      messageFilter.personaId = new Types.ObjectId(personaId);
    }

    const messageDirectionCounts = await this.messageModel.aggregate([
      { $match: messageFilter },
      { $group: { _id: '$direction', count: { $sum: 1 } } },
    ]).exec();

    const messages = { inbound: 0, outbound: 0 };
    for (const group of messageDirectionCounts) {
      if (group._id in messages) {
        messages[group._id as keyof typeof messages] = group.count;
      }
    }

    // 4. Drafts count
    const draftFilter: any = { isDraft: true };
    if (personaId) {
      draftFilter.personaId = new Types.ObjectId(personaId);
    }
    const draftsCount = await this.messageModel.countDocuments(draftFilter).exec();

    // 5. Audit stats
    const auditFilter: any = {};
    if (personaId) {
      auditFilter.personaId = new Types.ObjectId(personaId);
    }
    const auditCounts = await this.auditModel.countDocuments(auditFilter).exec();

    return {
      leads: {
        total: leadsByStatus.active + leadsByStatus.paused + leadsByStatus.archived + leadsByStatus.blocked,
        ...leadsByStatus,
      },
      funnel: funnelDistribution,
      messages: {
        total: messages.inbound + messages.outbound,
        ...messages,
        drafts: draftsCount,
      },
      audit: {
        totalEvents: auditCounts,
      },
    };
  }

  async getDailySummary(personaId?: string | Types.ObjectId): Promise<any> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const filter: any = {};
    if (personaId) {
      filter.personaId = new Types.ObjectId(personaId);
    }

    // New leads today
    const newLeads = await this.candidateModel.countDocuments({
      ...filter,
      createdAt: { $gte: todayStart },
    }).exec();

    // Messages sent today (inbound + outbound)
    const messageFilter: any = { isDraft: false, sentAt: { $gte: todayStart } };
    if (personaId) {
      messageFilter.personaId = new Types.ObjectId(personaId);
    }

    const inboundToday = await this.messageModel.countDocuments({
      ...messageFilter,
      direction: 'inbound',
    }).exec();

    const outboundToday = await this.messageModel.countDocuments({
      ...messageFilter,
      direction: 'outbound',
    }).exec();

    const draftsCreatedToday = await this.messageModel.countDocuments({
      ...filter,
      isDraft: true,
      createdAt: { $gte: todayStart },
    }).exec();

    // Average latency today
    const avgLatencyMinutes = await this.calculateAverageLatency(personaId, todayStart);

    return {
      newLeads,
      messagesToday: {
        inbound: inboundToday,
        outbound: outboundToday,
        total: inboundToday + outboundToday,
      },
      draftsCreatedToday,
      avgLatencyMinutes,
    };
  }

  private async calculateAverageLatency(
    personaId?: string | Types.ObjectId,
    since?: Date,
  ): Promise<number> {
    const query: any = { direction: 'outbound', isDraft: false };
    if (personaId) {
      query.personaId = new Types.ObjectId(personaId);
    }
    if (since) {
      query.sentAt = { $gte: since };
    }

    const recentOutbound = await this.messageModel
      .find(query)
      .sort({ sentAt: -1 })
      .limit(100)
      .exec();

    if (recentOutbound.length === 0) return 0;

    let totalDiffMs = 0;
    let counted = 0;

    for (const outMsg of recentOutbound) {
      const prevInbound = await this.messageModel
        .findOne({
          candidateId: outMsg.candidateId,
          direction: 'inbound',
          sentAt: { $lt: outMsg.sentAt },
        })
        .sort({ sentAt: -1 })
        .exec();

      if (prevInbound) {
        totalDiffMs += outMsg.sentAt.getTime() - prevInbound.sentAt.getTime();
        counted++;
      }
    }

    if (counted === 0) return 0;
    const avgMs = totalDiffMs / counted;
    return Math.round(avgMs / 1000 / 60); // in minutes
  }
}
