import { Injectable, Logger } from '@nestjs/common';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { MainMenuPanel } from '../panels/main-menu.panel';
import { LeadsPanel } from '../panels/leads.panel';
import { LeadDetailPanel } from '../panels/lead-detail.panel';
import { DraftsPanel } from '../panels/drafts.panel';
import { PersonasPanel } from '../panels/personas.panel';
import { ImportPanel } from '../panels/import.panel';
import { MediaPanel } from '../panels/media.panel';
import { BridgePanel } from '../panels/bridge.panel';
import { ContentGroupPanel } from '../panels/content-group.panel';
import { ContentSendPanel } from '../panels/content-send.panel';
import { ClearAllCommand } from '../commands/clear-all.command';

@Injectable()
export class CallbackHandler {
  private readonly logger = new Logger(CallbackHandler.name);

  constructor(
    private readonly mainMenu: MainMenuPanel,
    private readonly leads: LeadsPanel,
    private readonly leadDetail: LeadDetailPanel,
    private readonly drafts: DraftsPanel,
    private readonly personas: PersonasPanel,
    private readonly imports: ImportPanel,
    private readonly media: MediaPanel,
    private readonly bridge: BridgePanel,
    private readonly contentGroup: ContentGroupPanel,
    private readonly contentSend: ContentSendPanel,
    private readonly clearAll: ClearAllCommand,
  ) {}

  async handle(ctx: BotContext): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (!data) return;

    // Cancel any pending text input when user clicks a button
    if (ctx.session.awaitingInput) {
      ctx.session.awaitingInput = undefined;
      ctx.session.pendingLeadName = undefined;
      ctx.session.pendingPersonaName = undefined;
      ctx.session.selectedPersonaId = undefined;
    }

    try {
      await ctx.answerCallbackQuery();

      const [action, ...params] = data.split(':');

      switch (action) {
        // ─── Main Menu ───
        case 'menu': {
          const subAction = params[0];
          if (subAction === 'settings') {
            await this.mainMenu.renderSettings(ctx);
          } else if (subAction === 'help') {
            await this.mainMenu.renderHelp(ctx);
          } else if (subAction === 'analytics' || subAction === 'summary_refresh') {
            await this.mainMenu.renderAnalytics(ctx);
          } else {
            await this.mainMenu.render(ctx);
          }
          break;
        }

        // ─── Leads ───
        case 'leads': {
          const subAction = params[0];
          if (subAction === 'create') {
            await this.leads.handleCreate(ctx);
          } else if (subAction === 'select_persona') {
            await this.leads.handleSelectPersona(ctx, params.slice(1));
          } else {
            await this.leads.render(ctx, params);
          }
          break;
        }
        case 'lead':
          await this.leadDetail.render(ctx, params);
          break;
        case 'lead_status':
          await this.leadDetail.handleStatus(ctx, params);
          break;
        case 'manual_reply':
          await this.leadDetail.handleManualReplyAction(ctx, params);
          break;

        // ─── AI Draft ───
        case 'draft':
          await this.drafts.handleDraftAction(ctx, params);
          break;
        case 'drafts':
          await this.drafts.render(ctx, params);
          break;
        case 'rewrite':
          await this.drafts.handleRewrite(ctx, params);
          break;
        case 'generate':
          await this.drafts.handleGenerate(ctx, params);
          break;

        // ─── Funnel ───
        case 'funnel':
          await this.leadDetail.handleFunnel(ctx, params);
          break;

        // ─── Personas ───
        case 'personas': {
          const subAction = params[0];
          if (subAction === 'create') {
            await this.personas.handleCreate(ctx);
          } else if (subAction === 'edit') {
            await this.personas.handleEdit(ctx, params.slice(1));
          } else {
            await this.personas.render(ctx, params);
          }
          break;
        }
        case 'persona_select':
          await this.personas.handleSelect(ctx, params);
          break;

        // ─── Import ───
        case 'import':
          await this.imports.handleAction(ctx, params);
          break;

        // ─── Media Library ───
        case 'media':
          await this.media.render(ctx, params);
          break;

        // ─── Bridge ───
        case 'bridge':
          await this.bridge.handleAction(ctx, params);
          break;

        // ─── Content Group ───
        case 'content_group':
          await this.contentGroup.handleAction(ctx, params);
          break;

        case 'content_send':
          await this.contentSend.handleAction(ctx, params);
          break;

        // ─── Automation ───
        case 'auto':
          await this.leadDetail.handleAutomation(ctx, params);
          break;

        // ─── Clear All ───
        case 'clear_all': {
          const subAction = params[0];
          if (subAction === 'prompt') {
            await this.clearAll.handle(ctx);
          } else if (subAction === 'confirm') {
            await this.clearAll.handleConfirm(ctx);
          }
          break;
        }

        // ─── No-op (pagination indicators etc.) ───
        case 'noop':
          break;

        default:
          this.logger.warn(`Unknown callback action: ${action}`);
          break;
      }
    } catch (err: any) {
      const errMsg = err.message || '';
      if (
        errMsg.includes('message is not modified') ||
        errMsg.includes('query is too old') ||
        errMsg.includes('query ID is invalid')
      ) {
        return;
      }
      this.logger.error(`Callback error for "${data}": ${errMsg}`);
      try {
        await ctx.reply(`❌ Error: ${errMsg}`);
      } catch (_) {
        // silently fail
      }
    }
  }
}
