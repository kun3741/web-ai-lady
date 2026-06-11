import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Candidate, CandidateSchema } from './schemas/candidate.schema';
import { ContactsService } from './contacts.service';
import { AuditModule } from '@modules/audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Candidate.name, schema: CandidateSchema }]),
    AuditModule,
  ],
  providers: [ContactsService],
  exports: [ContactsService, MongooseModule],
})
export class ContactsModule {}
