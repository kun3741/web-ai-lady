import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AutomationPolicy } from './schemas/automation-policy.schema';

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    @InjectModel(AutomationPolicy.name) private readonly policyModel: Model<AutomationPolicy>,
  ) {}

  async getPolicyForCandidate(
    candidateId: string | Types.ObjectId,
    personaId: string | Types.ObjectId,
    workspaceId: string | Types.ObjectId,
  ): Promise<AutomationPolicy> {
    // 1. Check Candidate level policy
    let policy = await this.policyModel.findOne({
      scope: 'candidate',
      scopeId: new Types.ObjectId(candidateId),
    }).exec();

    if (policy) return policy;

    // 2. Check Persona level policy
    policy = await this.policyModel.findOne({
      scope: 'persona',
      scopeId: new Types.ObjectId(personaId),
    }).exec();

    if (policy) return policy;

    // 3. Check Workspace level policy
    policy = await this.policyModel.findOne({
      scope: 'workspace',
      scopeId: new Types.ObjectId(workspaceId),
    }).exec();

    if (policy) return policy;

    // 4. Return system fallback policy (stub)
    const fallback = new this.policyModel({
      scope: 'workspace',
      scopeId: new Types.ObjectId(workspaceId),
      mode: 'draft',
      minConfidenceForAutosend: 0.85,
      neverAutosendMedia: true,
      requireApprovalForTopics: ['money', 'travel', 'meeting'],
      maxAutosendsPerHour: 10,
    });
    return fallback;
  }

  async setPolicy(
    scope: 'workspace' | 'persona' | 'candidate',
    scopeId: string | Types.ObjectId,
    update: Partial<AutomationPolicy>,
  ): Promise<AutomationPolicy> {
    const scopeIdObj = new Types.ObjectId(scopeId);
    return this.policyModel.findOneAndUpdate(
      { scope, scopeId: scopeIdObj },
      { ...update, scope, scopeId: scopeIdObj },
      { new: true, upsert: true },
    ).exec();
  }

  async evaluateAutomation(
    candidateId: string | Types.ObjectId,
    personaId: string | Types.ObjectId,
    workspaceId: string | Types.ObjectId,
    draftConfidence: number,
    topics: string[] = [],
    hasMedia: boolean = false,
  ): Promise<{ autosend: boolean; reason: string }> {
    const policy = await this.getPolicyForCandidate(candidateId, personaId, workspaceId);

    if (policy.mode === 'paused') {
      return { autosend: false, reason: 'Automation is paused' };
    }

    if (policy.mode === 'draft') {
      return { autosend: false, reason: 'Policy mode is Draft Only' };
    }

    if (hasMedia && policy.neverAutosendMedia) {
      return { autosend: false, reason: 'Draft contains media and policy disallows media auto-send' };
    }

    // Check if any topic requires manual approval
    const requireApproval = topics.some(topic => policy.requireApprovalForTopics.includes(topic));
    if (requireApproval) {
      const matchedTopics = topics.filter(topic => policy.requireApprovalForTopics.includes(topic));
      return { autosend: false, reason: `Draft matches topics requiring approval: ${matchedTopics.join(', ')}` };
    }

    if (policy.mode === 'assisted') {
      if (draftConfidence < policy.minConfidenceForAutosend) {
        return {
          autosend: false,
          reason: `Confidence score ${draftConfidence.toFixed(2)} is below threshold ${policy.minConfidenceForAutosend}`,
        };
      }
      return { autosend: true, reason: 'Assisted mode: confidence score is above threshold and no flagged topics' };
    }

    if (policy.mode === 'full') {
      return { autosend: true, reason: 'Full automation: draft is safe and no restricted topics detected' };
    }

    return { autosend: false, reason: 'Unknown policy state' };
  }
}
