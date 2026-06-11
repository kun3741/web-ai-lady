# Допрацювання Virtual Lady AI Bot — Зведений план реалізації

Зведений план на основі двох планів (`implementation_plan.md` + `implementation_plan2.md`), з детальною прив'язкою до існуючого коду після повного аналізу кодової бази.

## Поточний стан після аналізу коду

Проект — **NestJS monorepo** (api + workers), MongoDB + Redis/BullMQ + grammY. Ключові знахідки:

| Що вже є | Де |
|---|---|
| Session з полями bridge/import flow | [telegram.module.ts](file:///d:/work/programming/js/web-lady-ai/src/infrastructure/telegram/telegram.module.ts) — `SessionData` вже має `awaitingImportPersonaId`, `bridgePersonaId`, `bridgePendingApiId/ApiHash/Phone` |
| Document handler (import JSON) | [document.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/document.handler.ts) — вже працює (скачує файл, запускає import job) |
| Import panel — базова версія | [import.panel.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/panels/import.panel.ts) — показує список jobs, але **немає кнопки upload** |
| MediaLibraryService.upload() | [media-library.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/media-library/media-library.service.ts) — приймає `{buffer, originalname, mimetype}` + type/tags |
| MemoryService.extractFromMessage() | [memory.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/memory/memory.service.ts) — LLM-витяг фактів |
| AutomationService.evaluateAutomation() | [automation.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/automation/automation.service.ts) — повна логіка autosend |
| Persona schema — без MTProto полів | [persona.schema.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-accounts/schemas/persona.schema.ts) |
| Candidate має `telegramUserId` | [candidate.schema.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/contacts/schemas/candidate.schema.ts) |
| `crypto-js` в dependencies | [package.json](file:///d:/work/programming/js/web-lady-ai/package.json) — є, для шифрування session strings |
| `ENCRYPTION_KEY` в .env | [.env](file:///d:/work/programming/js/web-lady-ai/.env) — є |
| Bot НЕ зареєстрований для `message:document` | [bot.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/bot.service.ts) — тільки `callback_query:data` та `message:text` |

---

## Proposed Changes — 7 компонентів

### Компонент 1: Імпорт JSON з Telegram-інтерфейсу бота

**Мета:** адмін натискає кнопку в боті → вибирає персону → відправляє JSON файл → імпорт запускається.

> [!NOTE]
> `DocumentHandler` і `SessionData.awaitingImportPersonaId` вже є. Потрібно: додати кнопку upload в import panel, обробити callback вибору персони, зареєструвати document handler в bot.service.

#### [MODIFY] [import.panel.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/panels/import.panel.ts)
- Inject `Persona` model
- Додати кнопку «📥 Загрузити JSON» → `import:upload` callback
- Метод `handleAction` — при `action === 'upload'` показати список персон як inline-кнопки (`import:select_persona:<id>`)
- При `action === 'select_persona'` — поставити `session.awaitingInput = 'import_file'`, `session.awaitingImportPersonaId = id`, відповісти інструкцією

#### [MODIFY] [callback.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/callback.handler.ts)
- Callbacks `import:upload` та `import:select_persona:ID` вже делегуються через `case 'import': await this.imports.handleAction(ctx, params)` — тому треба лише оновити `ImportPanel.handleAction`

#### [MODIFY] [bot.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/bot.service.ts)
- Inject `DocumentHandler`
- Зареєструвати `this.bot.on('message:document', (ctx) => this.documentHandler.handle(ctx))` **перед** `message:text`

#### [MODIFY] [telegram-bot.module.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/telegram-bot.module.ts)
- Додати `DocumentHandler` в `providers`
- Додати `ImportJob` + `ImportJobSchema` в `MongooseModule.forFeature` (якщо ще немає)

---

### Компонент 2: Обробка пересланих повідомлень (forwarded messages)

**Мета:** адмін пересилає повідомлення кандидата в бот → бот визначає кандидата → зберігає як inbound → генерує чернетку.

#### [NEW] [forward.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/forward.handler.ts)
- Inject: `ContactsService`, `MessagesService`, `ConversationsService`, `MemoryService`, `Persona` model, `SettingsService`
- Метод `handle(ctx: BotContext)`:
  1. Перевірити `ctx.message?.forward_origin` або `ctx.message?.forward_from`
  2. Витягти `forward_from.id` (числовий ID) або `forward_sender_name` (якщо privacy hidden)
  3. Знайти активну персону з `session.activePersonaId`
  4. Знайти кандидата по `telegramUserId = forward_from.id.toString()` в цій персоні
  5. Якщо не знайдений — запропонувати створити (кнопка `forward:create_lead:<telegram_id>:<sender_name>`)
  6. Зберегти як inbound: `MessagesService.createMessage({direction: 'inbound', ...})`
  7. Запустити `MemoryService.extractFromMessage()`
  8. Відповісти підтвердженням + кнопка «📝 Згенерувати чернетку» → `generate:<candidateId>`

#### [MODIFY] [bot.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/bot.service.ts)
- Inject `ForwardHandler`
- Зареєструвати фільтр: `this.bot.on('message', ...)` з перевіркою `ctx.message?.forward_origin || ctx.message?.forward_from`, передати в forward handler. **Зареєструвати перед `message:text`**

#### [MODIFY] [callback.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/callback.handler.ts)
- Додати case `'forward'` → делегувати в `ForwardHandler` для обробки `forward:create_lead:...`

#### [MODIFY] [telegram-bot.module.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/telegram-bot.module.ts)
- Додати `ForwardHandler` в `providers`

---

### Компонент 3: Завантаження медіа з Telegram

**Мета:** адмін відправляє фото/відео/голосове → медіа-бібліотека персони.

#### [NEW] [media-upload.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/media-upload.handler.ts)
- Inject: `MediaLibraryService`, `ConfigService`, `Persona` model
- Обробка `message:photo`, `message:video`, `message:voice`, `message:video_note`
- Для кожного типу:
  1. Отримати `file_id` (`ctx.message.photo?.at(-1)?.file_id`, `ctx.message.video?.file_id`, etc.)
  2. Скачати через `ctx.api.getFile(file_id)` + `fetch`
  3. Визначити `type: 'photo' | 'video' | 'voice'`
  4. Знайти активну персону з `session.activePersonaId`
  5. Викликати `MediaLibraryService.upload(personaId, { buffer, originalname, mimetype }, type)`
  6. Відповісти підтвердженням з кнопкою «🎬 Медіа-бібліотека» → `media:list:<personaId>`

#### [MODIFY] [bot.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/bot.service.ts)
- Inject `MediaUploadHandler`
- Зареєструвати:
  ```
  this.bot.on('message:photo', (ctx) => this.mediaUploadHandler.handle(ctx));
  this.bot.on('message:video', (ctx) => this.mediaUploadHandler.handle(ctx));
  this.bot.on('message:voice', (ctx) => this.mediaUploadHandler.handle(ctx));
  this.bot.on('message:video_note', (ctx) => this.mediaUploadHandler.handle(ctx));
  ```

#### [MODIFY] [telegram-bot.module.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/telegram-bot.module.ts)
- Додати `MediaUploadHandler` в `providers`

---

### Компонент 4: Розширений AI pipeline — auto-draft + auto-send

**Мета:** при збереженні inbound повідомлення автоматично генерувати чернетку і, якщо policy дозволяє, відправляти.

#### [NEW] [inbound-pipeline.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/ai/services/inbound-pipeline.service.ts)
- Inject: `AiOrchestratorService`, `MessagesService`, `ConversationsService`, `MemoryService`, `AutomationService`, `SettingsService`, `AuditService`, `BOT_INSTANCE`
- Метод `processInbound(personaId, candidateId, messageText, adminChatId?)`:
  1. Зберегти inbound повідомлення → `MessagesService.createMessage()`
  2. Витяг пам'яті → `MemoryService.extractFromMessage()`
  3. Генерація чернетки → `AiOrchestratorService.generateDraft()`
  4. Зберегти чернетку → `MessagesService.createMessage({ isDraft: true, ... })`
  5. Оцінити automation policy → `AutomationService.evaluateAutomation()`
  6. Якщо `autosend` — відправити через bridge (якщо Компонент 5 готовий) або залишити як draft
  7. Якщо НЕ autosend — надіслати адміну повідомлення з чернеткою через `bot.api.sendMessage(adminChatId, ...)`

#### [MODIFY] [ai.module.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/ai/ai.module.ts)
- Додати `InboundPipelineService` в `providers` та `exports`
- Додати необхідні imports: `AutomationModule`, `AuditModule`, `ConversationsModule`, `SettingsModule`

#### [MODIFY] [forward.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/forward.handler.ts)
- Після збереження inbound повідомлення → викликати `InboundPipelineService.processInbound()`

---

### Компонент 5: MTProto Bridge (GramJS) ⭐

> [!IMPORTANT]
> Ключовий новий компонент. Дозволяє боту читати і відправляти повідомлення від імені реального Telegram-акаунту дівчини.

**Архітектура:**
```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│ Admin Bot   │────▸│ Bridge       │────▸│ Girl's TG Account│
│ (grammY)    │     │ (GramJS)     │     │ (MTProto session) │
│ draft/approve│    │ sendMessage  │     │ sends to candidate│
└─────────────┘     │ readMessages │     └──────────────────┘
                    └──────────────┘
```

#### npm install `telegram` (GramJS)

#### [MODIFY] [persona.schema.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-accounts/schemas/persona.schema.ts)
- Додати поля:
  - `mtprotoSessionEncrypted: string` — зашифрований `StringSession` (використовуючи `crypto-js` + `ENCRYPTION_KEY`)
  - `mtprotoApiId: number`
  - `mtprotoApiHash: string`
  - `mtprotoConnected: boolean` — поточний статус з'єднання
  - `mtprotoPhone: string` — номер телефону
- Всі нові поля `@Prop({ default: '' })` або `@Prop({ default: false })` — щоб не ламати існуючі документи

#### [NEW] [mtproto-bridge.service.ts](file:///d:/work/programming/js/web-lady-ai/src/infrastructure/telegram/mtproto-bridge.service.ts)
- Singleton NestJS сервіс
- `private clients = new Map<string, TelegramClient>()` — personaId → client
- Методи:
  - `connect(personaId, apiId, apiHash, sessionString)` — створити клієнт, підключити
  - `disconnect(personaId)` — відключити, видалити з map
  - `sendMessage(personaId, chatId, text)` — відправити текст від імені акаунта
  - `sendMedia(personaId, chatId, buffer, type, caption?)` — відправити медіа
  - `isConnected(personaId)` — boolean
  - `getClient(personaId)` — для listener'а
- Шифрування/дешифрування session string через `CryptoJS.AES.encrypt/decrypt` + `ENCRYPTION_KEY` з ConfigService
- `OnModuleInit` — автоматично підключити всі персони з `mtprotoSessionEncrypted` з БД

#### [NEW] [mtproto-listener.service.ts](file:///d:/work/programming/js/web-lady-ai/src/infrastructure/telegram/mtproto-listener.service.ts)
- Для кожного підключеного клієнта — `client.addEventHandler(callback, new NewMessage({}))`
- При новому повідомленні:
  1. Визначити `senderId` → знайти `Candidate` по `telegramUserId`
  2. Якщо знайдений → зберегти як inbound → запустити `InboundPipelineService`
  3. Якщо не знайдений → логувати, ігнорувати (або створити нового кандидата)

#### [NEW] [bridge.panel.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/panels/bridge.panel.ts)
- UI для авторизації MTProto:
  1. «🔗 Підключити акаунт» → ввести api_id → ввести api_hash → ввести номер телефону
  2. GramJS ініціює login → запитує код підтвердження → адмін вводить код
  3. Якщо 2FA → запитує пароль
  4. StringSession зберігається зашифрованим в Persona
  5. Показує статус: 🟢 Connected / 🔴 Disconnected
  6. Кнопка «🔌 Відключити»

#### [MODIFY] [personas.panel.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/panels/personas.panel.ts)
- Додати кнопку «🔗 Bridge» на картці персони → `bridge:menu:<personaId>`
- Показувати `🟢 Bridge: Connected` або `🔴 Bridge: Disconnected` в інфо

#### [MODIFY] [text-message.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/text-message.handler.ts)
- Додати flows: `bridge_api_id`, `bridge_api_hash`, `bridge_phone`, `bridge_code`, `bridge_2fa`

#### [MODIFY] [callback.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/callback.handler.ts)
- Inject `BridgePanel`
- Додати case `'bridge'` → делегувати в BridgePanel

#### [MODIFY] [telegram-bot.module.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/telegram-bot.module.ts)
- Додати `BridgePanel` в providers

#### [MODIFY] [telegram.module.ts](file:///d:/work/programming/js/web-lady-ai/src/infrastructure/telegram/telegram.module.ts)
- Додати `MtprotoBridgeService`, `MtprotoListenerService` як providers та exports
- Додати в imports: `MongooseModule.forFeature([Persona])`, `ConfigModule`

---

### Компонент 6: Відправка чернеток через bridge

**Мета:** кнопка «✅ Відправити» → перевірка bridge → відправка від імені акаунту.

#### [NEW] [message-sender.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/messages/message-sender.service.ts)
- Центральний сервіс відправки:
  1. Перевірити bridge: `MtprotoBridgeService.isConnected(personaId)`
  2. Якщо connected → `MtprotoBridgeService.sendMessage(personaId, candidate.telegramUserId, text)`
  3. Якщо not connected → fallback (показати для копіювання)
  4. Оновити `isDraft = false`, `direction = 'outbound'` в БД
  5. Audit log

#### [MODIFY] [messages.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/messages/messages.service.ts)
- `approveDraft()` → доповнити виклик `MessageSenderService.sendVia(draftId)` замість простого `findByIdAndUpdate`

#### [MODIFY] [drafts.panel.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/panels/drafts.panel.ts)
- Кнопка «✅ Відправити» тепер:
  1. Якщо bridge connected → відправляє через bridge, показує «✅ Надіслано через акаунт»
  2. Якщо bridge not connected → показує текст для копіювання + кнопку «📋 Копіювати»
- Додати кнопку «📋 Копіювати текст» як альтернативу

#### [MODIFY] [messages.module.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/messages/messages.module.ts)
- Додати `MessageSenderService` в providers та exports

---

### Компонент 7: Допрацювання UI та ручні відповіді

#### [MODIFY] [lead-detail.panel.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/panels/lead-detail.panel.ts)
- Додати кнопку «💬 Написати вручну» → `manual_reply:start:<candidateId>`
- Додати кнопку «📥 Переслати повідомлення» → інструкція як переслати
- Показати останнє повідомлення кандидата в картці (inject `MessagesService`, query `getLastInboundMessage`)

#### [MODIFY] [text-message.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/text-message.handler.ts)
- Додати flow `manual_reply`:
  1. Адмін пише текст
  2. Зберегти як outbound повідомлення
  3. Якщо bridge connected → відправити через bridge
  4. Якщо ні → показати для копіювання

#### [MODIFY] [callback.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/callback.handler.ts)
- Обробити `manual_reply:start:<candidateId>` — поставити `session.awaitingInput = 'manual_reply'`, `session.activeCandidateId = candidateId`

---

## Порядок реалізації

| # | Компонент | Залежності | Складність | Нових файлів |
|---|-----------|-----------|------------|-------------|
| 1 | Імпорт JSON з бота | — | 🟢 Проста | 0 (модифікації) |
| 2 | Forward handler | — | 🟢 Проста | 1 |
| 3 | Медіа upload | — | 🟢 Проста | 1 |
| 5 | **MTProto Bridge** | `npm install telegram` | 🔴 Складна | 3 |
| 4 | AI auto-pipeline | Comp 2 | 🟡 Середня | 1 |
| 6 | Відправка через bridge | Comp 5 | 🟡 Середня | 1 |
| 7 | UI допрацювання | Comp 5, 6 | 🟡 Середня | 0 |

**Порядок: 1 → 2 → 3 → 5 → 4 → 6 → 7**

---

## User Review Required

> [!IMPORTANT]
> **MTProto Bridge (Компонент 5) — ризики:**
> - Telegram може забанити акаунт за використання неофіційних клієнтів (рідко, але можливо)
> - Потрібні `api_id` та `api_hash` з [my.telegram.org](https://my.telegram.org) для кожного акаунту
> - StringSession зберігається зашифрованим (AES + `ENCRYPTION_KEY`), але потребує надійного ключа

> [!IMPORTANT]
> **DocumentHandler вже існує, але не зареєстрований в bot.service.ts**
> Він вже повністю функціональний — скачує JSON, зберігає файл, запускає import job. Його просто треба підключити.

## Open Questions

> [!WARNING]
> **`FALLBACK_ADMIN_FROM_ID = '7404772966'`** — hardcoded ID у `import.processor.ts` та `style-extractor.service.ts`. Чи правильний для всіх чатів? Якщо у різних чатах `from_id` дівчини різний — потрібно передавати його при створенні персони.

> [!WARNING]
> **API credentials**: Для MTProto bridge потрібні `api_id` і `api_hash` з [my.telegram.org](https://my.telegram.org). Кожна персона потребує свої credentials. Чи є у вас вже ці дані?

## Verification Plan

### Automated Tests
- `npm run build` після кожного компоненту — перевірка компіляції
- Перевірка що новий DocumentHandler handler реєструється без помилок

### Manual Verification
- **Компонент 1:** Відправити JSON-файл в бот → перевірити імпорт
- **Компонент 2:** Переслати повідомлення → перевірити збереження як inbound
- **Компонент 3:** Відправити фото/відео → перевірити медіа-бібліотеку
- **Компонент 5:** Підключити тестовий акаунт через bridge → перевірити з'єднання
- **Компонент 6:** Затвердити чернетку → перевірити відправку через bridge
- **Компонент 7:** Натиснути «💬 Написати вручну» → перевірити flow
