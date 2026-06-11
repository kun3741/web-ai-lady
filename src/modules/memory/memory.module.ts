import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MemoryItem, MemoryItemSchema } from './schemas/memory-item.schema';
import { MemoryService } from './memory.service';
import { LlmModule } from '@infrastructure/llm/llm.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: MemoryItem.name, schema: MemoryItemSchema }]),
    LlmModule,
  ],
  providers: [MemoryService],
  exports: [MemoryService, MongooseModule],
})
export class MemoryModule {}
