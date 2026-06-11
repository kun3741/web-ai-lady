import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditEvent } from './schemas/audit-event.schema';

interface AuditLogParams {
  workspaceId: string;
  personaId?: string | null;
  candidateId?: string | null;
  action: string;
  actor: 'admin' | 'system' | 'ai';
  details?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectModel(AuditEvent.name) private readonly auditModel: Model<AuditEvent>) {}

  async log(params: AuditLogParams): Promise<AuditEvent> {
    const event = await this.auditModel.create({
      workspaceId: new Types.ObjectId(params.workspaceId),
      personaId: params.personaId ? new Types.ObjectId(params.personaId) : null,
      candidateId: params.candidateId ? new Types.ObjectId(params.candidateId) : null,
      action: params.action,
      actor: params.actor,
      details: params.details || {},
      timestamp: new Date(),
    });
    this.logger.debug(`Audit: ${params.action} by ${params.actor}`);
    return event;
  }

  async query(
    workspaceId: string,
    filters: { action?: string; actor?: string; limit?: number } = {},
  ): Promise<AuditEvent[]> {
    const query: Record<string, unknown> = { workspaceId: new Types.ObjectId(workspaceId) };
    if (filters.action) query.action = filters.action;
    if (filters.actor) query.actor = filters.actor;

    return this.auditModel
      .find(query)
      .sort({ timestamp: -1 })
      .limit(filters.limit || 50)
      .exec();
  }
}
