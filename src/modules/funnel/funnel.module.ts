import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FunnelStageState, FunnelStageStateSchema } from './schemas/funnel-stage-state.schema';
import { FunnelService } from './funnel.service';
import { AuditModule } from '@modules/audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: FunnelStageState.name, schema: FunnelStageStateSchema }]),
    AuditModule,
  ],
  providers: [FunnelService],
  exports: [FunnelService, MongooseModule],
})
export class FunnelModule {}
