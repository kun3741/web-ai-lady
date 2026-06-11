import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduledJob, ScheduledJobSchema } from './schemas/scheduled-job.schema';
import { Persona, PersonaSchema } from '../telegram-accounts/schemas/persona.schema';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ScheduledJob.name, schema: ScheduledJobSchema },
      { name: Persona.name, schema: PersonaSchema },
    ]),
  ],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
