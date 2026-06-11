import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Conversation, ConversationSchema } from './schemas/conversation.schema';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Conversation.name, schema: ConversationSchema }])],
  providers: [ConversationsService],
  exports: [ConversationsService, MongooseModule],
})
export class ConversationsModule {}
