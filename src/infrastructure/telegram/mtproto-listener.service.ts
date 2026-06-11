import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MtprotoBridgeService } from './mtproto-bridge.service';
import { ContactsService } from '@modules/contacts/contacts.service';
import { MessagesService } from '@modules/messages/messages.service';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { MemoryService } from '@modules/memory/memory.service';
import { SettingsService } from '@modules/settings/settings.service';
import { InboundPipelineService } from '@modules/ai/services/inbound-pipeline.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';
import { NewMessage, NewMessageEvent } from 'telegram/events';

@Injectable()
export class MtprotoListenerService implements OnModuleInit {
  private readonly logger = new Logger(MtprotoListenerService.name);
  private readonly listeningPersonaIds = new Set<string>();
  private readonly debouncers = new Map<string, NodeJS.Timeout>();
  private readonly accumulatedTexts = new Map<string, string[]>();

  constructor(
    private readonly bridge: MtprotoBridgeService,
    private readonly contactsService: ContactsService,
    private readonly messagesService: MessagesService,
    private readonly conversationsService: ConversationsService,
    private readonly memoryService: MemoryService,
    private readonly settingsService: SettingsService,
    private readonly inboundPipeline: InboundPipelineService,
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
  ) {}

  async onModuleInit() {
    // Delay listener setup to let bridge connect first
    setTimeout(() => this.setupAllListeners(), 5000);
  }

  /**
   * Set up message listeners for all connected bridge clients
   */
  async setupAllListeners(): Promise<void> {
    const connectedIds = this.bridge.getConnectedPersonaIds();
    for (const personaId of connectedIds) {
      await this.setupListener(personaId);
    }
    this.logger.log(`Message listeners set up for ${connectedIds.length} personas`);
  }

  /**
   * Set up a message listener for a specific persona's bridge client
   */
  async setupListener(personaId: string): Promise<void> {
    if (this.listeningPersonaIds.has(personaId)) {
      return; // Already listening
    }

    const client = this.bridge.getClient(personaId);
    if (!client) {
      this.logger.warn(`Cannot set up listener: bridge not connected for persona ${personaId}`);
      return;
    }

    client.addEventHandler(
      (event: NewMessageEvent) => this.handleIncomingMessage(personaId, event),
      new NewMessage({}),
    );

    this.listeningPersonaIds.add(personaId);
    this.logger.log(`Message listener active for persona: ${personaId}`);
  }

  /**
   * Remove listener tracking for a persona (client disconnect handles actual removal)
   */
  removeListener(personaId: string): void {
    this.listeningPersonaIds.delete(personaId);
  }

  /**
   * Handle an incoming message from a persona's MTProto client
   */
  private async handleIncomingMessage(personaId: string, event: NewMessageEvent): Promise<void> {
    try {
      const client = this.bridge.getClient(personaId);
      if (!client) return;

      const message = event.message;
      if (!message || message.out) return; // Skip outgoing messages

      // Only handle private messages (direct candidate chat)
      if (!event.isPrivate) return;

      const senderId = message.senderId?.toString();
      if (!senderId) return;

      const messageText = message.text || message.message || '';
      if (!messageText || messageText.length < 1) return;

      const persona = await this.personaModel.findById(personaId).exec();
      if (!persona) return;

      let displayName = `User ${senderId}`;
      let resolvedName = false;
      try {
        const idVal = /^-?\d+$/.test(senderId) ? BigInt(senderId) : senderId;
        const entity = await client.getEntity(idVal as any);
        if (entity) {
          const first = (entity as any).firstName || '';
          const last = (entity as any).lastName || '';
          const username = (entity as any).username ? ` (@${(entity as any).username})` : '';
          const fullName = [first, last].filter(Boolean).join(' ').trim();
          if (fullName) {
            displayName = `${fullName}${username}`;
            resolvedName = true;
          } else if ((entity as any).username) {
            displayName = `@${(entity as any).username}`;
            resolvedName = true;
          }
        }
      } catch (err: any) {
        this.logger.warn(`Failed to resolve entity name for sender ${senderId}: ${err.message}`);
      }

      // Search by telegramUserId in candidates for this persona
      const candidateDoc = await this.contactsService.findOrCreate(
        personaId,
        senderId,
        displayName,
      );

      if (candidateDoc && resolvedName && candidateDoc.displayName.startsWith('User ')) {
        candidateDoc.displayName = displayName;
        await (candidateDoc as any).save();
      }

      if (!candidateDoc) {
        this.logger.debug(`Ignoring message from unknown sender ${senderId} for persona ${personaId}`);
        return;
      }

      // Save as inbound message
      const conv = await this.conversationsService.findOrCreate(
        personaId,
        candidateDoc._id.toString(),
      );

      await this.messagesService.createMessage({
        conversationId: conv._id,
        personaId: new Types.ObjectId(personaId),
        candidateId: candidateDoc._id,
        telegramMessageId: message.id,
        direction: 'inbound',
        isDraft: false,
        normalizedText: messageText,
        confidence: 1,
        safetyStatus: 'safe',
        sentAt: new Date(message.date * 1000),
      });

      const candidateId = candidateDoc._id.toString();

      // Accumulate text for combined notification
      let texts = this.accumulatedTexts.get(candidateId) || [];
      texts.push(messageText);
      this.accumulatedTexts.set(candidateId, texts);

      // Debounce pipeline execution by 5 seconds
      const existingTimer = this.debouncers.get(candidateId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(async () => {
        this.debouncers.delete(candidateId);
        const collectedTexts = this.accumulatedTexts.get(candidateId) || [messageText];
        this.accumulatedTexts.delete(candidateId);

        const combinedText = collectedTexts.join(' | ');

        try {
          this.logger.log(`Executing debounced inbound pipeline for candidate ${candidateId} (persona: ${personaId}) with ${collectedTexts.length} messages`);
          await this.inboundPipeline.processInbound(
            personaId,
            candidateId,
            combinedText,
          );
        } catch (err: any) {
          this.logger.error(`Error in debounced inbound pipeline: ${err.message}`);
        }
      }, 5000);

      this.debouncers.set(candidateId, timer);

      this.logger.debug(
        `Inbound message saved and pipeline scheduled (debounced): persona=${persona.name}, sender=${senderId}, text=${messageText.substring(0, 50)}`,
      );
    } catch (err) {
      this.logger.error(`Error handling incoming bridge message: ${(err as Error).message}`);
    }
  }
}
