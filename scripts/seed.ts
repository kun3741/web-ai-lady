import mongoose, { Schema } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

// Manual simple env loader to avoid external dependencies
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

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/virtual-lady';

async function seed() {
  console.log(`Connecting to MongoDB at ${MONGO_URI}...`);
  await mongoose.connect(MONGO_URI);
  console.log('Connected!');

  // 1. Create Workspace
  console.log('Seeding workspace...');
  const WorkspaceSchema = new Schema({}, { strict: false, collection: 'workspaces' });
  const WorkspaceModel = mongoose.model('Workspace', WorkspaceSchema);
  
  await WorkspaceModel.deleteMany({});
  const workspace = await WorkspaceModel.create({
    name: 'Default Workspace',
    adminTelegramIds: ['7404772966'], // seed Di's admin ID
    globalPaused: false,
    settings: {
      timezone: 'Europe/Kiev',
      defaults: {},
    },
  });
  console.log(`Created Workspace: ${workspace._id}`);

  // 2. Create Persona
  console.log('Seeding persona...');
  const PersonaSchema = new Schema({}, { strict: false, collection: 'personas' });
  const PersonaModel = mongoose.model('Persona', PersonaSchema);
  
  await PersonaModel.deleteMany({});
  const persona = await PersonaModel.create({
    workspaceId: workspace._id,
    name: 'Di',
    telegramAccountId: 'user7404772966',
    status: 'active',
    quietHours: { start: '23:00', end: '08:00', timezone: 'Europe/Kiev' },
  });
  console.log(`Created Persona: ${persona._id}`);

  // 3. Create Candidate
  console.log('Seeding candidate...');
  const CandidateSchema = new Schema({}, { strict: false, collection: 'candidates' });
  const CandidateModel = mongoose.model('Candidate', CandidateSchema);
  
  await CandidateModel.deleteMany({});
  const candidate = await CandidateModel.create({
    personaId: persona._id,
    telegramUserId: '12345678',
    displayName: 'George Греция',
    status: 'active',
    riskScore: 0,
    tags: ['vip', 'greece'],
    profile: {
      age: 32,
      location: 'Athens, Greece',
      occupation: 'Software Engineer',
    },
  });
  console.log(`Created Candidate: ${candidate._id}`);

  // 4. Create FunnelStageState
  console.log('Seeding funnel stage...');
  const FunnelSchema = new Schema({}, { strict: false, collection: 'funnel_stage_states' });
  const FunnelModel = mongoose.model('FunnelStageState', FunnelSchema);
  
  await FunnelModel.deleteMany({});
  const funnel = await FunnelModel.create({
    candidateId: candidate._id,
    personaId: persona._id,
    stage: 'rapport',
    objective: 'Deepen the connection through meaningful conversation and shared experiences.',
  });
  console.log(`Created FunnelStageState for Candidate: ${funnel._id}`);

  // 5. Create Conversation
  console.log('Seeding conversation...');
  const ConversationSchema = new Schema({}, { strict: false, collection: 'conversations' });
  const ConversationModel = mongoose.model('Conversation', ConversationSchema);
  
  await ConversationModel.deleteMany({});
  const conversation = await ConversationModel.create({
    personaId: persona._id,
    candidateId: candidate._id,
    telegramChatId: '12345678',
    language: 'ru',
    messageCount: 2,
    lastMessageAt: new Date(),
    status: 'active',
  });
  console.log(`Created Conversation: ${conversation._id}`);

  // 6. Create Messages (Inbound, Outbound, Draft)
  console.log('Seeding messages...');
  const MessageSchema = new Schema({}, { strict: false, collection: 'messages' });
  const MessageModel = mongoose.model('Message', MessageSchema);
  
  await MessageModel.deleteMany({});

  // Inbound message
  await MessageModel.create({
    conversationId: conversation._id,
    personaId: persona._id,
    candidateId: candidate._id,
    telegramMessageId: 100001,
    direction: 'inbound',
    normalizedText: 'Привет! Как твои дела? Что делаешь сегодня вечером?',
    mediaType: null,
    isDraft: false,
    sentAt: new Date(Date.now() - 3600000), // 1 hour ago
  });

  // Outbound message (replied)
  await MessageModel.create({
    conversationId: conversation._id,
    personaId: persona._id,
    candidateId: candidate._id,
    telegramMessageId: 100002,
    direction: 'outbound',
    normalizedText: 'Привет! Все отлично, отдыхаю дома. Как твои дела?',
    mediaType: null,
    isDraft: false,
    sentAt: new Date(Date.now() - 1800000), // 30 mins ago
  });

  // New Inbound message (which needs reply)
  await MessageModel.create({
    conversationId: conversation._id,
    personaId: persona._id,
    candidateId: candidate._id,
    telegramMessageId: 100003,
    direction: 'inbound',
    normalizedText: 'Тоже отлично! Думаю о нашей встрече. Может спланируем поездку?',
    mediaType: null,
    isDraft: false,
    sentAt: new Date(Date.now() - 60000), // 1 min ago
  });

  // Seed a pending AI Draft
  await MessageModel.create({
    conversationId: conversation._id,
    personaId: persona._id,
    candidateId: candidate._id,
    telegramMessageId: 100004,
    direction: 'outbound',
    normalizedText: 'О, это звучит потрясающе! Я бы с удовольствием спланировала поездку. Куда именно ты хочешь поехать?',
    mediaType: null,
    isDraft: true,
    confidence: 0.92,
    safetyStatus: 'safe',
    draftTone: 'warm',
    sentAt: new Date(),
  });

  console.log('Seeding completed successfully!');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
