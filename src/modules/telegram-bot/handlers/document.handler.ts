import { Injectable, Logger } from '@nestjs/common';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { ImportsService } from '@modules/imports/imports.service';
import { SettingsService } from '@modules/settings/settings.service';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DocumentHandler {
  private readonly logger = new Logger(DocumentHandler.name);

  constructor(
    private readonly importsService: ImportsService,
    private readonly settingsService: SettingsService,
    private readonly config: ConfigService,
  ) {}

  async handle(ctx: BotContext): Promise<void> {
    const doc = ctx.message?.document;
    if (!doc) return;

    const personaId = ctx.session.awaitingImportPersonaId;

    // Only handle documents when user is in import flow
    if (!personaId || ctx.session.awaitingInput !== 'import_file') {
      await ctx.reply(
        '💡 Чтобы импортировать JSON-чат, откройте раздел *Импорт* в меню и нажмите «📥 Загрузить JSON».',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    // Validate file type
    const fileName = doc.file_name || 'import.json';
    if (!fileName.endsWith('.json')) {
      await ctx.reply('❌ Поддерживаются только файлы формата `.json` (экспорт Telegram Desktop).', {
        parse_mode: 'Markdown',
      });
      return;
    }

    try {
      await ctx.reply('⏳ Скачиваю файл и запускаю импорт...');

      // Download file from Telegram
      const file = await ctx.api.getFile(doc.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${this.config.get('TELEGRAM_ADMIN_BOT_TOKEN')}/${file.file_path}`;

      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());

      // Save to local imports directory
      const uploadsDir = path.resolve(
        this.config.get('LOCAL_STORAGE_PATH', './uploads'),
        'imports',
      );
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const localFileName = `${Date.now()}_${fileName}`;
      const filePath = path.join(uploadsDir, localFileName);
      fs.writeFileSync(filePath, buffer);

      // Start import job
      const ws = await this.settingsService.getOrCreateDefault();
      const job = await this.importsService.startImport(
        ws._id.toString(),
        personaId,
        fileName,
        filePath,
      );

      // Clear session
      ctx.session.awaitingInput = undefined;
      ctx.session.awaitingImportPersonaId = undefined;

      await ctx.reply(
        `✅ *Импорт запущен!*\n\n` +
          `*Файл:* \`${fileName}\`\n` +
          `*Размер:* ${Math.round(buffer.length / 1024)} KB\n` +
          `*Job ID:* \`${job._id}\`\n\n` +
          `Обработка выполняется в фоне. Проверьте статус в разделе *Импорт*.`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      this.logger.error(`Import file handling failed: ${(err as Error).message}`);
      ctx.session.awaitingInput = undefined;
      ctx.session.awaitingImportPersonaId = undefined;
      await ctx.reply(`❌ Ошибка импорта: ${(err as Error).message}`);
    }
  }
}
