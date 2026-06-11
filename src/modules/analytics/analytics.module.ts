import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Candidate, CandidateSchema } from '../contacts/schemas/candidate.schema';
import { Message, MessageSchema } from '../messages/schemas/message.schema';
import { FunnelStageState, FunnelStageStateSchema } from '../funnel/schemas/funnel-stage-state.schema';
import { AuditEvent, AuditEventSchema } from '../audit/schemas/audit-event.schema';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Candidate.name, schema: CandidateSchema },
      { name: Message.name, schema: MessageSchema },
      { name: FunnelStageState.name, schema: FunnelStageStateSchema },
      { name: AuditEvent.name, schema: AuditEventSchema },
    ]),
  ],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
