import { Injectable, Logger } from '@nestjs/common';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { SettingsService } from '@modules/settings/settings.service';
import { AuditService } from '@modules/audit/audit.service';

@Injectable()
export class PanicCommand {
  private readonly logger = new Logger(PanicCommand.name);

  constructor(
    private readonly settingsService: SettingsService,
    private readonly auditService: AuditService,
  ) {}

  async handle(ctx: BotContext): Promise<void> {
    const ws = await this.settingsService.getOrCreateDefault();
    await this.settingsService.setGlobalPause(true);

    await this.auditService.log({
      workspaceId: ws._id.toString(),
      action: 'panic.activated',
      actor: 'admin',
      details: { triggeredBy: ctx.from?.id?.toString() },
    });

    this.logger.warn('🚨 PANIC activated — all autopilot paused');

    await ctx.reply(
      `🚨 *PANIC ACTIVATED*\n\n` +
        `Все автопилоты ВЫКЛЮЧЕНЫ.\n` +
        `Все AI-генерации ОСТАНОВЛЕНЫ.\n` +
        `Только ручное управление.\n\n` +
        `Для возобновления — используйте настройки.`,
      { parse_mode: 'Markdown' },
    );
  }
}
