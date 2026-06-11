import mongoose, { Schema } from 'mongoose';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as CryptoJS from 'crypto-js';
import * as fs from 'fs';
import * as path from 'path';

// Manual simple env loader
try {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of envLines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value.trim();
      }
    }
  }
} catch (_) {}

const MONGO_URI = process.env.MONGODB_URI!;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';
const GROUP_ID = '2183482722';

function decryptSession(encrypted: string): string {
  const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}

async function main() {
  await mongoose.connect(MONGO_URI, { dbName: process.env.MONGODB_DB_NAME });
  const PersonaSchema = new Schema({}, { strict: false, collection: 'personas' });
  const PersonaModel = mongoose.model('Persona', PersonaSchema);
  
  const personas = await PersonaModel.find({
    mtprotoSessionEncrypted: { $ne: '' },
    mtprotoApiId: { $gt: 0 },
    status: 'active',
  }).exec();

  const persona = personas[0] as any;
  const sessionString = decryptSession(persona.mtprotoSessionEncrypted);
  const client = new TelegramClient(
    new StringSession(sessionString),
    persona.mtprotoApiId,
    persona.mtprotoApiHash,
    { connectionRetries: 3 },
  );

  await client.connect();
  const { Api } = await import('telegram/tl');

  const entity = await client.getEntity(BigInt('-100' + GROUP_ID) as any);
  
  // Get ALL forum topics with pagination
  let allTopics: any[] = [];
  let offsetDate = 0;
  let offsetId = 0;
  let offsetTopic = 0;
  
  while (true) {
    const result = await client.invoke(
      new Api.channels.GetForumTopics({
        channel: entity,
        limit: 100,
        offsetDate,
        offsetId,
        offsetTopic,
      }),
    );
    
    const topics = (result as any).topics || [];
    if (topics.length === 0) break;
    allTopics = allTopics.concat(topics);
    
    // Set offset for next page
    const lastTopic = topics[topics.length - 1];
    offsetDate = lastTopic.date || 0;
    offsetId = lastTopic.topMessage || 0;
    offsetTopic = lastTopic.id || 0;
    
    if (topics.length < 100) break;
  }

  console.log(`\nTotal topics found: ${allTopics.length}\n`);
  console.log('=== ALL TOPICS (sorted by ID) ===\n');
  
  allTopics.sort((a, b) => a.id - b.id);
  
  for (const topic of allTopics) {
    const closed = topic.closed ? ' [CLOSED]' : '';
    const hidden = topic.hidden ? ' [HIDDEN]' : '';
    console.log(`ID: ${String(topic.id).padStart(6)} | "${topic.title}"${closed}${hidden}`);
  }

  await client.disconnect();
  await mongoose.disconnect();
}

main().catch(console.error);
