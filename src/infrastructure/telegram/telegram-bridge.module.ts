import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { Persona, PersonaSchema } from '@modules/telegram-accounts/schemas/persona.schema';
import { MtprotoBridgeService } from './mtproto-bridge.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([{ name: Persona.name, schema: PersonaSchema }]),
  ],
  providers: [MtprotoBridgeService],
  exports: [MtprotoBridgeService, MongooseModule],
})
export class TelegramBridgeModule {}
