import { Injectable, Logger } from '@nestjs/common';
import { BotContext } from '@infrastructure/telegram/telegram.module';
import { MediaLibraryService } from '@modules/media-library/media-library.service';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Persona } from '@modules/telegram-accounts/schemas/persona.schema';
import { InlineKeyboard } from 'grammy';

@Injectable()
export class MediaUploadHandler {
  private readonly logger = new Logger(MediaUploadHandler.name);

  constructor(
    private readonly mediaLibrary: MediaLibraryService,
    private readonly config: ConfigService,
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
  ) {}

  async handle(ctx: BotContext): Promise<void> {
    const msg = ctx.message;
    if (!msg) return;

    // Determine active persona
    const personaId = ctx.session.activePersonaId;
    if (!personaId) {
      await ctx.reply(
        '⚠️ *Не выбран активный аккаунт*\n\n' +
          'Перейдите в «Аккаунты» и выберите персону перед загрузкой медиа.',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const persona = await this.personaModel.findById(personaId).exec();
    if (!persona) {
      await ctx.reply('❌ Активный аккаунт не найден. Выберите заново через меню.');
      return;
    }

    try {
      let fileId: string | undefined;
      let type: 'photo' | 'video' | 'voice' | 'document' = 'document';
      let fileName = 'upload';
      let mimeType = 'application/octet-stream';

      if (msg.photo && msg.photo.length > 0) {
        // Take the highest quality photo (last in array)
        const photo = msg.photo[msg.photo.length - 1];
        fileId = photo.file_id;
        type = 'photo';
        fileName = `photo_${Date.now()}.jpg`;
        mimeType = 'image/jpeg';
      } else if (msg.video) {
        fileId = msg.video.file_id;
        type = 'video';
        fileName = msg.video.file_name || `video_${Date.now()}.mp4`;
        mimeType = msg.video.mime_type || 'video/mp4';
      } else if (msg.voice) {
        fileId = msg.voice.file_id;
        type = 'voice';
        fileName = `voice_${Date.now()}.ogg`;
        mimeType = msg.voice.mime_type || 'audio/ogg';
      } else if (msg.video_note) {
        fileId = msg.video_note.file_id;
        type = 'video';
        fileName = `video_note_${Date.now()}.mp4`;
        mimeType = 'video/mp4';
      }

      if (!fileId) {
        await ctx.reply('⚠️ Не удалось определить медиа-файл в сообщении.');
        return;
      }

      await ctx.reply('⏳ Загружаю медиа в библиотеку...');

      // Download file from Telegram
      const file = await ctx.api.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${this.config.get('TELEGRAM_ADMIN_BOT_TOKEN')}/${file.file_path}`;

      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());

      // Upload to media library
      const asset = await this.mediaLibrary.upload(
        personaId,
        {
          buffer,
          originalname: fileName,
          mimetype: mimeType,
        },
        type,
        persona.mediaLibraryTag ? [persona.mediaLibraryTag] : [],
      );

      const typeEmoji = type === 'voice' ? '🎤' : type === 'video' ? '🎥' : '📷';
      const sizeKb = Math.round(buffer.length / 1024);

      const keyboard = new InlineKeyboard()
        .text('🎬 Медиа-библиотека', `media:list:${personaId}`)
        .row()
        .text('🔙 Меню', 'menu');

      await ctx.reply(
        `${typeEmoji} *Медиа загружено!*\n\n` +
          `*Файл:* \`${fileName}\`\n` +
          `*Размер:* ${sizeKb} KB\n` +
          `*Тип:* ${type}\n` +
          `*Персона:* ${persona.name}\n` +
          `*Режим:* 🔒 Только вручную _(по умолчанию)_`,
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    } catch (err) {
      this.logger.error(`Media upload failed: ${(err as Error).message}`);
      await ctx.reply(`❌ Ошибка загрузки медиа: ${(err as Error).message}`);
    }
  }
}
