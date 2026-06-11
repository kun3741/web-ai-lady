import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AutomationPolicy, AutomationPolicySchema } from './schemas/automation-policy.schema';
import { AutomationService } from './automation.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AutomationPolicy.name, schema: AutomationPolicySchema }]),
  ],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
