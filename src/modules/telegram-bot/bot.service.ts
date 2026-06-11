import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import { BotContext, BOT_INSTANCE } from '@infrastructure/telegram/telegram.constants';
import { CallbackHandler } from './handlers/callback.handler';
import { StartCommand } from './commands/start.command';
import { PanicCommand } from './commands/panic.command';
import { ClearAllCommand } from './commands/clear-all.command';
import { TextMessageHandler } from './handlers/text-message.handler';
import { DocumentHandler } from './handlers/document.handler';
import { ForwardHandler } from './handlers/forward.handler';
import { MediaUploadHandler } from './handlers/media-upload.handler';
import { SettingsService } from '@modules/settings/settings.service';

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);

  constructor(
    @Inject(BOT_INSTANCE) private readonly bot: Bot<BotContext> | null,
    private readonly config: ConfigService,
    private readonly callbackHandler: CallbackHandler,
    private readonly startCommand: StartCommand,
    private readonly panicCommand: PanicCommand,
    private readonly clearAllCommand: ClearAllCommand,
    private readonly textMessageHandler: TextMessageHandler,
    private readonly documentHandler: DocumentHandler,
    private readonly forwardHandler: ForwardHandler,
    private readonly mediaUploadHandler: MediaUploadHandler,
    private readonly settingsService: SettingsService,
  ) {}

  async onModuleInit() {
    if (!this.bot) {
      this.logger.warn('Bot token not configured — skipping bot setup');
      return;
    }

    // Admin guard middleware
    this.bot.use(async (ctx, next) => {
      // Only handle updates from private chats
      if (ctx.chat?.type !== 'private') return;

      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const adminIds = this.config
        .get<string>('ADMIN_TELEGRAM_IDS', '')
        .split(',')
        .map((id) => id.trim());
      const isAdmin = adminIds.includes(userId) || (await this.settingsService.isAdmin(userId));

      if (!isAdmin) {
        return;
      }

      await next();
    });

    // Reset pending conversational inputs when a command is sent
    this.bot.use(async (ctx, next) => {
      const text = ctx.message?.text?.trim();
      if (text && text.startsWith('/')) {
        ctx.session.awaitingInput = undefined;
        ctx.session.pendingLeadName = undefined;
        ctx.session.pendingPersonaName = undefined;
        ctx.session.selectedPersonaId = undefined;
        ctx.session.activeCandidateId = undefined;
        ctx.session.bridgePersonaId = undefined;
        ctx.session.bridgePendingApiId = undefined;
        ctx.session.bridgePendingApiHash = undefined;
        ctx.session.bridgePendingPhone = undefined;
      }
      await next();
    });

    // Register text commands. Routine navigation lives in inline buttons.
    this.bot.command('start', (ctx) => this.startCommand.handle(ctx));
    this.bot.command('panic', (ctx) => this.panicCommand.handle(ctx));
    this.bot.command('clear_all', (ctx) => this.clearAllCommand.handle(ctx));

    // Register callback query handler (ALL inline button interactions)
    this.bot.on('callback_query:data', (ctx) => this.callbackHandler.handle(ctx));

    // Register document handler (JSON import) — BEFORE text handler
    this.bot.on('message:document', (ctx) => this.documentHandler.handle(ctx));

    // Register forwarded message handler — BEFORE text handler
    this.bot.on('message', (ctx, next) => {
      if (this.forwardHandler.isForwarded(ctx)) {
        return this.forwardHandler.handle(ctx);
      }
      return next();
    });

    // Register text message handler (multi-step input flows)
    this.bot.on('message:text', (ctx) => this.textMessageHandler.handle(ctx));

    // Register media upload handlers
    this.bot.on('message:photo', (ctx) => this.mediaUploadHandler.handle(ctx));
    this.bot.on('message:video', (ctx) => this.mediaUploadHandler.handle(ctx));
    this.bot.on('message:voice', (ctx) => this.mediaUploadHandler.handle(ctx));
    this.bot.on('message:video_note', (ctx) => this.mediaUploadHandler.handle(ctx));

    // Error handler
    this.bot.catch((err) => {
      this.logger.error(`Bot error: ${err.message}`, err.stack);
    });

    // Start polling
    const usePolling = this.config.get('TELEGRAM_POLLING_ENABLED', 'true') === 'true';
    if (usePolling) {
      this.bot.start({
        onStart: () => this.logger.log('Admin bot started (polling mode)'),
      });
    } else {
      this.logger.log('Bot configured for webhook mode — skipping polling start');
    }
  }

  async onModuleDestroy() {
    if (this.bot) {
      await this.bot.stop();
      this.logger.log('Bot stopped');
    }
  }

  getBot(): Bot<BotContext> | null {
    return this.bot;
  }
}
