import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as CryptoJS from 'crypto-js';

@Injectable()
export class MtprotoBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MtprotoBridgeService.name);
  private readonly clients = new Map<string, TelegramClient>();
  private readonly encryptionKey: string;

  constructor(
    private readonly config: ConfigService,
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
  ) {
    this.encryptionKey = this.config.get<string>('ENCRYPTION_KEY', '');
  }

  async onModuleInit() {
    if (process.env.IS_WORKER === 'true') {
      this.logger.log('Running in worker process — skipping bridge auto-connect');
      return;
    }
    // Auto-connect all personas that have saved MTProto sessions
    try {
      const personas = await this.personaModel
        .find({
          mtprotoSessionEncrypted: { $ne: '' },
          mtprotoApiId: { $gt: 0 },
          mtprotoApiHash: { $ne: '' },
          status: 'active',
        })
        .exec();

      for (const persona of personas) {
        try {
          const sessionString = this.decryptSession(persona.mtprotoSessionEncrypted);
          await this.connect(
            persona._id.toString(),
            persona.mtprotoApiId,
            persona.mtprotoApiHash,
            sessionString,
          );
          this.logger.log(`Auto-connected bridge for persona: ${persona.name}`);
        } catch (err) {
          this.logger.error(
            `Failed to auto-connect bridge for ${persona.name}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`Bridge auto-connect failed: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    for (const [personaId, client] of this.clients.entries()) {
      try {
        await client.disconnect();
        this.logger.log(`Disconnected bridge for persona: ${personaId}`);
      } catch (err) {
        this.logger.error(`Error disconnecting bridge for ${personaId}: ${(err as Error).message}`);
      }
    }
    this.clients.clear();
  }

  /**
   * Connect a MTProto client for a persona using existing session
   */
  async connect(
    personaId: string,
    apiId: number,
    apiHash: string,
    sessionString: string,
  ): Promise<void> {
    // Disconnect existing client if any
    if (this.clients.has(personaId)) {
      await this.disconnect(personaId);
    }

    const session = new StringSession(sessionString);
    const client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 3,
    });

    await client.connect();

    if (!(await client.isUserAuthorized())) {
      throw new Error('Session is not authorized. Re-authenticate.');
    }

    this.clients.set(personaId, client);

    // Warm up entity cache asynchronously in the background by fetching recent dialogs
    client.getDialogs({ limit: 50 }).catch((err) => {
      this.logger.error(`Failed to pre-warm entity cache for persona ${personaId}: ${err.message}`);
    });

    // Update connection status in DB
    await this.personaModel
      .findByIdAndUpdate(personaId, {
        mtprotoConnected: true,
      })
      .exec();

    this.logger.log(`MTProto bridge connected for persona: ${personaId}`);
  }

  /**
   * Start authentication flow — returns phone code hash for verification
   */
  async startAuth(
    personaId: string,
    apiId: number,
    apiHash: string,
    phoneNumber: string,
  ): Promise<{ client: TelegramClient; phoneCodeHash: string }> {
    const session = new StringSession('');
    const client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 3,
    });

    await client.connect();

    const result = await client.invoke(
      new (await import('telegram/tl')).Api.auth.SendCode({
        phoneNumber,
        apiId,
        apiHash,
        settings: new (await import('telegram/tl')).Api.CodeSettings({}),
      }),
    );

    // Store client temporarily for code verification
    this.clients.set(`pending_${personaId}`, client);

    return {
      client,
      phoneCodeHash: (result as any).phoneCodeHash,
    };
  }

  /**
   * Complete authentication with verification code
   */
  async completeAuth(
    personaId: string,
    phoneNumber: string,
    phoneCode: string,
    phoneCodeHash: string,
    password?: string,
  ): Promise<string> {
    const pendingKey = `pending_${personaId}`;
    const client = this.clients.get(pendingKey);
    if (!client) {
      throw new Error('No pending authentication found. Start auth again.');
    }

    try {
      try {
        await client.invoke(
          new (await import('telegram/tl')).Api.auth.SignIn({
            phoneNumber,
            phoneCode,
            phoneCodeHash,
          }),
        );
      } catch (err: any) {
        if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
          if (!password) {
            throw new Error('2FA_REQUIRED');
          }
          const passwordInfo = await client.invoke(
            new (await import('telegram/tl')).Api.account.GetPassword(),
          );
          const { computeCheck } = await import('telegram/Password');
          const srpResult = await computeCheck(passwordInfo, password);
          await client.invoke(
            new (await import('telegram/tl')).Api.auth.CheckPassword({
              password: srpResult,
            }),
          );
        } else {
          throw err;
        }
      }

      // Get session string and save
      const sessionString = (client.session as StringSession).save();

      // Move from pending to active
      this.clients.delete(pendingKey);
      this.clients.set(personaId, client);

      // Warm up entity cache asynchronously in the background by fetching recent dialogs
      client.getDialogs({ limit: 50 }).catch((err) => {
        this.logger.error(
          `Failed to pre-warm entity cache for persona ${personaId}: ${err.message}`,
        );
      });

      // Save encrypted session to DB
      const encryptedSession = this.encryptSession(sessionString);
      await this.personaModel
        .findByIdAndUpdate(personaId, {
          mtprotoSessionEncrypted: encryptedSession,
          mtprotoConnected: true,
          mtprotoPhone: phoneNumber,
        })
        .exec();

      this.logger.log(`MTProto bridge authenticated for persona: ${personaId}`);
      return sessionString;
    } catch (err) {
      // Clean up on failure
      this.clients.delete(pendingKey);
      try {
        await client.disconnect();
      } catch (_) {}
      throw err;
    }
  }

  /**
   * Disconnect MTProto client for a persona
   */
  async disconnect(personaId: string): Promise<void> {
    const client = this.clients.get(personaId);
    if (client) {
      try {
        await client.disconnect();
      } catch (err) {
        this.logger.error(`Error disconnecting: ${(err as Error).message}`);
      }
      this.clients.delete(personaId);
    }

    await this.personaModel
      .findByIdAndUpdate(personaId, {
        mtprotoConnected: false,
      })
      .exec();

    this.logger.log(`MTProto bridge disconnected for persona: ${personaId}`);
  }

  /**
   * Send a text message from a persona's account
   */
  async sendMessage(personaId: string, chatId: string, text: string): Promise<void> {
    const client = this.clients.get(personaId);
    if (!client) {
      throw new Error(`Bridge not connected for persona ${personaId}`);
    }

    const idVal = /^-?\d+$/.test(chatId) ? BigInt(chatId) : chatId;
    try {
      const targetEntity = await client.getEntity(idVal as any);
      await client.sendMessage(targetEntity, { message: text });
    } catch (err: any) {
      if (err.message.includes('Could not find the input entity')) {
        this.logger.log(
          `Entity cache empty for ${chatId}, fetching recent dialogs to repopulate cache...`,
        );
        await client.getDialogs({ limit: 50 });
        const targetEntity = await client.getEntity(idVal as any);
        await client.sendMessage(targetEntity, { message: text });
      } else {
        throw err;
      }
    }
    this.logger.debug(`Message sent via bridge for persona ${personaId} to ${chatId}`);
  }

  /**
   * Send media from a persona's account
   */
  async sendMedia(
    personaId: string,
    chatId: string,
    buffer: Buffer,
    fileName: string,
    caption?: string,
    attributes?: { voiceNote?: boolean; videoNote?: boolean },
  ): Promise<void> {
    const client = this.clients.get(personaId);
    if (!client) {
      throw new Error(`Bridge not connected for persona ${personaId}`);
    }

    (buffer as any).name = fileName;
    const idVal = /^-?\d+$/.test(chatId) ? BigInt(chatId) : chatId;

    try {
      const targetEntity = await client.getEntity(idVal as any);
      await client.sendFile(targetEntity, {
        file: buffer,
        caption: caption || '',
        voiceNote: attributes?.voiceNote,
        videoNote: attributes?.videoNote,
      });
    } catch (err: any) {
      if (err.message.includes('Could not find the input entity')) {
        this.logger.log(
          `Entity cache empty for ${chatId}, fetching recent dialogs to repopulate cache...`,
        );
        await client.getDialogs({ limit: 50 });
        const targetEntity = await client.getEntity(idVal as any);
        await client.sendFile(targetEntity, {
          file: buffer,
          caption: caption || '',
          voiceNote: attributes?.voiceNote,
          videoNote: attributes?.videoNote,
        });
      } else {
        throw err;
      }
    }
    this.logger.debug(`Media sent via bridge for persona ${personaId} to ${chatId}`);
  }

  /**
   * Send typing action to a candidate
   */
  async sendTypingAction(personaId: string, chatId: string): Promise<void> {
    const client = this.clients.get(personaId);
    if (!client) return;

    try {
      const { Api } = await import('telegram/tl');
      const idVal = /^-?\d+$/.test(chatId) ? BigInt(chatId) : chatId;
      const targetEntity = await client.getEntity(idVal as any);
      await client.invoke(
        new Api.messages.SetTyping({
          peer: targetEntity,
          action: new Api.SendMessageTypingAction(),
        }),
      );
    } catch (err: any) {
      this.logger.warn(`Failed to send typing action: ${err.message}`);
    }
  }

  /**
   * Mark chat history with a candidate as read
   */
  async readHistory(personaId: string, chatId: string): Promise<void> {
    const client = this.clients.get(personaId);
    if (!client) {
      throw new Error(`Bridge not connected for persona ${personaId}`);
    }

    const idVal = /^-?\d+$/.test(chatId) ? BigInt(chatId) : chatId;
    try {
      const targetEntity = await client.getEntity(idVal as any);
      const { Api } = await import('telegram/tl');
      await client.invoke(
        new Api.messages.ReadHistory({
          peer: targetEntity,
          maxId: 0,
        }),
      );
    } catch (err: any) {
      if (err.message.includes('Could not find the input entity')) {
        this.logger.log(
          `Entity cache empty for ${chatId} in readHistory, fetching recent dialogs...`,
        );
        await client.getDialogs({ limit: 50 });
        const targetEntity = await client.getEntity(idVal as any);
        const { Api } = await import('telegram/tl');
        await client.invoke(
          new Api.messages.ReadHistory({
            peer: targetEntity,
            maxId: 0,
          }),
        );
      } else {
        throw err;
      }
    }
    this.logger.debug(`History read via bridge for persona ${personaId} and candidate ${chatId}`);
  }

  /**
   * Check if bridge is connected for a persona
   */
  isConnected(personaId: string): boolean {
    return this.clients.has(personaId);
  }

  /**
   * Get client for a persona (for listener setup)
   */
  getClient(personaId: string): TelegramClient | undefined {
    return this.clients.get(personaId);
  }

  /**
   * Get all connected persona IDs
   */
  getConnectedPersonaIds(): string[] {
    return Array.from(this.clients.keys()).filter((k) => !k.startsWith('pending_'));
  }

  /**
   * Get recent direct user dialogs
   */
  async getRecentDialogs(
    personaId: string,
    limit = 50,
  ): Promise<Array<{ id: string; name: string; username?: string; bot?: boolean }>> {
    const client = this.clients.get(personaId);
    if (!client) {
      throw new Error(`Bridge not connected for persona ${personaId}`);
    }

    const dialogs = await client.getDialogs({ limit });
    const result: Array<{ id: string; name: string; username?: string; bot?: boolean }> = [];

    for (const dialog of dialogs) {
      if (dialog.isUser && dialog.entity) {
        const entity = dialog.entity as any;
        const id = entity.id.toString();
        const firstName = entity.firstName || '';
        const lastName = entity.lastName || '';
        const displayName =
          [firstName, lastName].filter(Boolean).join(' ') || entity.username || `User ${id}`;

        result.push({
          id,
          name: displayName,
          username: entity.username,
          bot: entity.bot,
        });
      }
    }
    return result;
  }

  // ─── Encryption helpers ───

  private encryptSession(session: string): string {
    return CryptoJS.AES.encrypt(session, this.encryptionKey).toString();
  }

  private decryptSession(encrypted: string): string {
    const bytes = CryptoJS.AES.decrypt(encrypted, this.encryptionKey);
    return bytes.toString(CryptoJS.enc.Utf8);
  }
}
