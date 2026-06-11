# Допрацювання Virtual Lady AI Bot до повної готовності (v2)

## Оновлення: MTProto bridge включено

За запитом клієнтки, варіант В (MTProto userbot bridge) впроваджується одразу.
Бібліотека: `telegram` (GramJS) — зріла, підтримує StringSession, відправку повідомлень від реального акаунта.

---

## Proposed Changes — 7 компонентів

### Компонент 1: Імпорт JSON-файлу з Telegram-інтерфейсу

Адмін відправляє JSON-файл прямо в бот → бот зберігає → запускає import job.

#### [MODIFY] [telegram.module.ts](file:///d:/work/programming/js/web-lady-ai/src/infrastructure/telegram/telegram.module.ts)
- Додати `awaitingImportPersonaId?: string` у `SessionData`

#### [MODIFY] [import.panel.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/panels/import.panel.ts)
- Кнопка «📥 Загрузити JSON» → вибір персони → `session.awaitingInput = 'import_file'`

#### [NEW] [document.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/document.handler.ts)
- Обробник `message:document` — скачати файл, зберегти, запустити import

#### [MODIFY] [bot.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/bot.service.ts)
- Зареєструвати `document.handler` для `message:document`

#### [MODIFY] [callback.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/callback.handler.ts)
- Обробити `import:upload`, `import:select_persona:ID`

---

### Компонент 2: Обробка пересланих повідомлень (forwarded messages)

Адмін пересилає повідомлення кандидата → бот зберігає як inbound → генерує чернетку.

#### [NEW] [forward.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/forward.handler.ts)
- Визначення кандидата по `forward_from.id` або `forward_sender_name`
- Збереження як inbound → Memory extraction → Auto-draft

#### [MODIFY] [bot.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/bot.service.ts)
- Зареєструвати forward handler з перевіркою `msg.forward_origin`

---

### Компонент 3: Завантаження медіа з Telegram

Адмін відправляє фото/відео/голосове → медіа-бібліотека персони.

#### [NEW] [media-upload.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/media-upload.handler.ts)
- Обробка photo/video/voice/video_note
- Download + `MediaLibraryService.upload()`

#### [MODIFY] [bot.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/bot.service.ts)
- Зареєструвати media handlers

---

### Компонент 4: Розширений AI pipeline — auto-draft + auto-send

#### [NEW] [inbound-pipeline.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/ai/services/inbound-pipeline.service.ts)
- Центральний pipeline: inbound → save → memory extract → generate draft → evaluate auto → send or notify admin

---

### Компонент 5: MTProto Bridge (GramJS) ⭐

> [!IMPORTANT]
> Це ключовий новий компонент. Дозволяє боту читати і відправляти повідомлення від імені реального Telegram-акаунту дівчини.

**Архітектура:**
```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│ Admin Bot   │────▸│ Bridge       │────▸│ Girl's TG Account│
│ (grammY)    │     │ (GramJS)     │     │ (MTProto session) │
│ draft/approve│     │ sendMessage  │     │ sends to candidate│
└─────────────┘     │ readMessages │     └──────────────────┘
                    └──────────────┘
```

#### [NEW] `telegram` package → `package.json`
- `npm install telegram` (GramJS)

#### [NEW] [mtproto-bridge.service.ts](file:///d:/work/programming/js/web-lady-ai/src/infrastructure/telegram/mtproto-bridge.service.ts)
- Singleton сервіс з Map<personaId, TelegramClient>
- `connect(personaId, sessionString)` — підключити акаунт
- `disconnect(personaId)` — відключити
- `sendMessage(personaId, chatId, text)` — відправити від імені акаунта
- `sendMedia(personaId, chatId, mediaBuffer, type)` — медіа
- `getClient(personaId)` — отримати клієнт
- `isConnected(personaId)` — перевірка стану
- StringSession зберігається зашифрованим в БД (Persona)

#### [NEW] [mtproto-listener.service.ts](file:///d:/work/programming/js/web-lady-ai/src/infrastructure/telegram/mtproto-listener.service.ts)
- Для кожного підключеного акаунта — слухати incoming messages через `client.addEventHandler(NewMessage)`
- При новому повідомленні → визначити кандидата → зберегти як inbound → запустити inbound pipeline

#### [MODIFY] [persona.schema.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-accounts/schemas/persona.schema.ts)
- Додати поля:
  - `mtprotoSessionEncrypted: string` — зашифрований StringSession
  - `mtprotoApiId: number`
  - `mtprotoApiHash: string`
  - `mtprotoConnected: boolean` — статус з'єднання
  - `mtprotoPhone: string` — номер телефону для авторизації

#### [NEW] [bridge.panel.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/panels/bridge.panel.ts)
- UI для підключення акаунту:
  1. Адмін натискає «🔗 Підключити акаунт» на сторінці персони
  2. Вводить api_id, api_hash (з my.telegram.org)
  3. Вводить номер телефону
  4. Бот ініціює login через GramJS
  5. Адмін вводить код підтвердження (і 2FA пароль, якщо є)
  6. Session зберігається зашифрованим в БД
  7. Клієнт підключається і починає слухати повідомлення

#### [MODIFY] [personas.panel.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/panels/personas.panel.ts)
- Додати кнопку «🔗 Bridge» на картці персони
- Показувати статус підключення (🟢 Connected / 🔴 Disconnected)

#### [MODIFY] [callback.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/callback.handler.ts)
- Додати обробку `bridge:*` callbacks

#### [MODIFY] [text-message.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/text-message.handler.ts)
- Додати flows: `bridge_api_id`, `bridge_api_hash`, `bridge_phone`, `bridge_code`, `bridge_2fa`

#### [MODIFY] [.env](file:///d:/work/programming/js/web-lady-ai/.env)
- `ENCRYPTION_KEY` — вже є, використовуємо для шифрування session strings

---

### Компонент 6: Відправка чернеток через bridge

#### [MODIFY] [drafts.panel.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/panels/drafts.panel.ts)
- Кнопка «✅ Відправити» тепер:
  1. Перевіряє чи bridge підключений для цієї персони
  2. Якщо так → відправляє через MTProto bridge від імені акаунту
  3. Якщо ні → показує текст для копіювання (fallback суфлер-режим)
- Додати кнопку «📋 Копіювати текст» як альтернативу

#### [MODIFY] [messages.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/messages/messages.service.ts)
- `approveDraft()` → доповнити відправкою через bridge

#### [NEW] [message-sender.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/messages/message-sender.service.ts)
- Центральний сервіс відправки: перевірка bridge → відправка → оновлення статусу → audit log

---

### Компонент 7: Допрацювання UI та ручні відповіді

#### [MODIFY] [lead-detail.panel.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/panels/lead-detail.panel.ts)
- Кнопка «💬 Написати вручну» → flow ручного введення
- Показати останнє повідомлення кандидата

#### [MODIFY] [text-message.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/text-message.handler.ts)
- Flow `manual_reply` — адмін пише → зберігається як outbound → відправка через bridge

---

## Порядок реалізації

| # | Компонент | Залежності | Складність |
|---|-----------|-----------|------------|
| 1 | Імпорт JSON з бота | Нічого | 🟢 Проста |
| 2 | Forward handler | Нічого | 🟢 Проста |
| 3 | Медіа upload | Нічого | 🟢 Проста |
| 5 | **MTProto Bridge** | npm install telegram | 🔴 Складна |
| 4 | AI auto-pipeline | Comp 2 | 🟡 Середня |
| 6 | Відправка через bridge | Comp 5 | 🟡 Середня |
| 7 | UI допрацювання | Comp 5, 6 | 🟡 Середня |

**Пропоную: 1 → 2 → 3 → 5 → 4 → 6 → 7**

---

## Open Questions

> [!WARNING]
> **API credentials**: Для MTProto bridge потрібні `api_id` і `api_hash` з [my.telegram.org](https://my.telegram.org). Кожна персона/акаунт потребує свої credentials. Чи є у вас вже ці дані, чи потрібна інструкція?

> [!WARNING]  
> **`FALLBACK_ADMIN_FROM_ID = '7404772966'`** — hardcoded ID у import.processor.ts та style-extractor.service.ts. Чи правильний для всіх чатів?

## Verification Plan

### Automated Tests
- `npm run build` після кожного компоненту
- Ручний тест: створити персону → підключити bridge → імпортувати JSON → згенерувати чернетку → відправити через bridge

### Manual Verification  
- Підключити тестовий TG акаунт через bridge → перевірити що повідомлення доходять
- Переслати повідомлення → перевірити auto-draft
- Відправити фото/відео → перевірити медіа-бібліотеку
