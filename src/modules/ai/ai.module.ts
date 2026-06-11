import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Persona, PersonaSchema } from '../telegram-accounts/schemas/persona.schema';
import { PromptProfile, PromptProfileSchema } from '../prompting/schemas/prompt-profile.schema';
import { Candidate, CandidateSchema } from '../contacts/schemas/candidate.schema';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { InboundPipelineService } from './services/inbound-pipeline.service';
import { SafetyEvaluatorService } from './services/safety-evaluator.service';
import { ConfidenceScorerService } from './services/confidence-scorer.service';
import { ContextAssemblerService } from './services/context-assembler.service';
import { LanguageDetectorService } from './services/language-detector.service';
import { LlmModule } from '@infrastructure/llm/llm.module';
import { MemoryModule } from '@modules/memory/memory.module';
import { MessagesModule } from '@modules/messages/messages.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { FunnelModule } from '@modules/funnel/funnel.module';
import { PromptingModule } from '@modules/prompting/prompting.module';
import { AutomationModule } from '@modules/automation/automation.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { AuditModule } from '@modules/audit/audit.module';
import { ContentGroupModule } from '@modules/content-group/content-group.module';
import { TelegramBridgeModule } from '@infrastructure/telegram/telegram-bridge.module';

@Module({
  imports: [
    LlmModule,
    MemoryModule,
    MessagesModule,
    ConversationsModule,
    FunnelModule,
    PromptingModule,
    AutomationModule,
    SettingsModule,
    AuditModule,
    ContentGroupModule,
    TelegramBridgeModule,
    MongooseModule.forFeature([
      { name: Persona.name, schema: PersonaSchema },
      { name: PromptProfile.name, schema: PromptProfileSchema },
      { name: Candidate.name, schema: CandidateSchema },
    ]),
  ],
  providers: [
    AiOrchestratorService,
    InboundPipelineService,
    SafetyEvaluatorService,
    ConfidenceScorerService,
    ContextAssemblerService,
    LanguageDetectorService,
  ],
  exports: [AiOrchestratorService, InboundPipelineService, SafetyEvaluatorService],
})
export class AiModule {}
