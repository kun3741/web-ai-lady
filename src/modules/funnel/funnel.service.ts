import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FunnelStageState, FunnelStage, FUNNEL_STAGES } from './schemas/funnel-stage-state.schema';
import { AuditService } from '@modules/audit/audit.service';
import { FUNNEL_STAGE_CONFIG } from './funnel-stages.config';

@Injectable()
export class FunnelService {
  private readonly logger = new Logger(FunnelService.name);

  constructor(
    @InjectModel(FunnelStageState.name) private readonly funnelModel: Model<FunnelStageState>,
    private readonly auditService: AuditService,
  ) {}

  async getOrCreate(candidateId: string, personaId: string): Promise<FunnelStageState> {
    let state = await this.funnelModel
      .findOne({ candidateId: new Types.ObjectId(candidateId) })
      .exec();
    if (!state) {
      state = await this.funnelModel.create({
        candidateId: new Types.ObjectId(candidateId),
        personaId: new Types.ObjectId(personaId),
        stage: 'new',
        objective: FUNNEL_STAGE_CONFIG.new.objective,
      });
    }
    return state;
  }

  async transition(
    candidateId: string,
    toStage: FunnelStage,
    reason: string,
    triggeredBy: 'admin' | 'system' | 'ai',
    workspaceId: string,
  ): Promise<FunnelStageState | null> {
    const state = await this.funnelModel
      .findOne({ candidateId: new Types.ObjectId(candidateId) })
      .exec();
    if (!state) return null;

    const fromStage = state.stage;
    const config = FUNNEL_STAGE_CONFIG[toStage];
    if (!config) {
      this.logger.warn(`Invalid funnel stage: ${toStage}`);
      return null;
    }

    state.transitionHistory.push({
      from: fromStage,
      to: toStage,
      reason,
      triggeredBy,
      at: new Date(),
    });
    state.stage = toStage;
    state.objective = config.objective;
    state.enteredAt = new Date();
    await state.save();

    await this.auditService.log({
      workspaceId,
      personaId: state.personaId.toString(),
      candidateId,
      action: 'funnel.transition',
      actor: triggeredBy,
      details: { from: fromStage, to: toStage, reason },
    });

    this.logger.log(`Funnel: ${candidateId} moved ${fromStage} → ${toStage}`);
    return state;
  }

  async getStageDistribution(personaId: string): Promise<Record<string, number>> {
    const results = await this.funnelModel
      .aggregate([
        { $match: { personaId: new Types.ObjectId(personaId) } },
        { $group: { _id: '$stage', count: { $sum: 1 } } },
      ])
      .exec();
    const dist: Record<string, number> = {};
    for (const stage of FUNNEL_STAGES) dist[stage] = 0;
    for (const r of results) dist[r._id] = r.count;
    return dist;
  }

  getStageConfig(stage: FunnelStage) {
    return FUNNEL_STAGE_CONFIG[stage];
  }
}
