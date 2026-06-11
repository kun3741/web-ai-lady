import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface IStorageProvider {
  put(key: string, data: Buffer, contentType?: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getUrl(key: string): string;
}

export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';

@Injectable()
export class LocalStorageProvider implements IStorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly basePath: string;

  constructor(private readonly config: ConfigService) {
    this.basePath = config.get('LOCAL_STORAGE_PATH', './uploads');
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  async put(key: string, data: Buffer, _contentType?: string): Promise<string> {
    const filePath = path.join(this.basePath, key);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, data);
    return key;
  }

  async get(key: string): Promise<Buffer> {
    const filePath = path.join(this.basePath, key);
    return fs.readFileSync(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.basePath, key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = path.join(this.basePath, key);
    return fs.existsSync(filePath);
  }

  getUrl(key: string): string {
    return `file://${path.resolve(this.basePath, key)}`;
  }

  static checksum(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}
