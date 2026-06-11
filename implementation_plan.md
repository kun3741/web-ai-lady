# Допрацювання Virtual Lady AI Bot до повної готовності

## Поточний стан проекту

Проект має міцний фундамент на **NestJS + MongoDB + Redis/BullMQ + grammY**:

| Компонент | Статус | Примітки |
|---|---|---|
| Telegram бот (команди, inline-кнопки) | ✅ Готово | `/start`, `/panic`, `/clear_all` + повне inline-меню |
| Persona (акаунти дівчат) | ✅ Готово | CRUD, персональні дані, редагування через бот |
| Leads (кандидати) | ✅ Готово | CRUD, прив'язка до персони, статуси |
| Воронка (funnel) | ✅ Готово | 9 етапів, переходи, історія |
| AI-оркестратор | ✅ Готово | Генерація чернеток, rewrite, safety evaluator |
| Prompt Composer | ✅ Готово | System prompt з персоною, воронкою, стилем, пам'яттю |
| Context Assembler | ✅ Готово | Збирає всі дані для AI |
| Memory (пам'ять по кандидату) | ✅ Готово | LLM-витяг фактів, upsert, формат для промпту |
| Automation policies | ✅ Готово | draft / assisted / full / paused |
| Import JSON | ✅ Готово | Парсер, процесор, стиль-екстрактор, BullMQ |
| Style extractor | ✅ Готово | Пари "кандидат → відповідь дівчини", теги |
| Медіа-бібліотека | ✅ Готово | Upload, де-дуп, manual/auto toggle |
| Аналітика | ✅ Готово | Overview stats, daily summary |
| Транскрипція (Whisper) | ✅ Готово | OpenAI Whisper, mock fallback |
| Scheduler / quiet hours | ✅ Готово | Заплановані задачі, нічний режим |
| Audit log | ✅ Готово | Логування дій |
| **Імпорт з інтерфейсу Telegram** | ❌ Не готово | Відправка JSON-файлу прямо в бот |
| **Обробка forwarded повідомлень** | ❌ Не готово | Пересилка повідомлень кандидатів у бот |
| **Завантаження медіа через бот** | ❌ Не готово | Фото/відео/голосові в медіа-бібліотеку |
| **Фактична відправка чернеток** | ⚠️ Stub | `approveDraft()` лише знімає isDraft, але не відправляє в Telegram |
| **Пересилка тексту кандидату** | ❌ Не готово | Немає bridge до акаунта кандидата |
| **Розширений AI pipeline** | ⚠️ Частково | Немає auto-draft при новому вхідному, немає auto-send |
| **Обробка голосових від кандидатів** | ⚠️ Stub | Сервіс є, але не підключений до pipeline |

---

## Proposed Changes

Роботу розбито на **6 компонентів** від найпростіших до найскладніших. Кожен компонент можна доповнити незалежно.

---

### Компонент 1: Імпорт JSON-файлу з Telegram-інтерфейсу

Зараз імпорт запускається тільки через seed-скрипт або API. Потрібно: відправити JSON-файл прямо в бот → бот зберігає файл → запускає import job.

#### [MODIFY] [telegram.module.ts](file:///d:/work/programming/js/web-lady-ai/src/infrastructure/telegram/telegram.module.ts)
- Додати `awaitingImportPersonaId?: string` у `SessionData` — для прив'язки файлу до персони

#### [MODIFY] [import.panel.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/panels/import.panel.ts)
- Додати кнопку «📥 Загрузить JSON» на екран імпорту
- Показати список персон для вибору куди імпортувати
- Після вибору персони — поставити `session.awaitingInput = 'import_file'` та `session.awaitingImportPersonaId`

#### [MODIFY] [bot.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/bot.service.ts)
- Додати обробник `bot.on('message:document')` для прийому JSON-файлів
- Скачати файл через `ctx.api.getFile()` + `fetch`, зберегти в `uploads/imports/`, запустити `ImportsService.startImport()`

#### [MODIFY] [callback.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/callback.handler.ts)
- Обробити нові callback-дані: `import:upload`, `import:select_persona:ID`

---

### Компонент 2: Обробка пересланих повідомлень (forwarded messages)

Клієнтка пересилає повідомлення кандидата в бот → бот зберігає як inbound → генерує чернетку.

#### [NEW] [forward.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/forward.handler.ts)
- Обробка `message:forward_origin` / forwarded-from
- Визначення: від якого кандидата (по `forward_from.id` або `forward_sender_name`)
- Якщо кандидат не знайдений — запропонувати створити або прив'язати
- Збереження повідомлення як inbound в Messages + Memory extraction
- Автогенерація чернетки якщо policy дозволяє

#### [MODIFY] [bot.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/bot.service.ts)
- Зареєструвати `forwardHandler` перед текстовим хендлером
- Додати перевірку: якщо повідомлення переслане — передати в forward handler

#### [MODIFY] [text-message.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/text-message.handler.ts)
- Додати flow `manual_reply` — коли адмін вводить текст для відправки конкретному кандидату (запис як outbound, знімає isDraft)

---

### Компонент 3: Завантаження медіа з Telegram

Адмін відправляє фото/відео/голосове в бот → бот зберігає в медіа-бібліотеку персони.

#### [NEW] [media-upload.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/media-upload.handler.ts)
- Обробка `message:photo`, `message:video`, `message:voice`, `message:video_note`
- Скачування файлу через Telegram Bot API
- Виклик `MediaLibraryService.upload()` з прив'язкою до активної персони
- Повернення підтвердження з кнопкою перегляду в медіа-бібліотеці

#### [MODIFY] [bot.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/bot.service.ts)
- Зареєструвати хендлери для `message:photo`, `message:video`, `message:voice`, `message:video_note`

---

### Компонент 4: Розширений AI pipeline — auto-draft + auto-send

Зараз AI генерує чернетку тільки по кнопці. Потрібно: автоматична генерація при новому inbound + auto-send якщо policy = full/assisted.

#### [NEW] [inbound-pipeline.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/ai/services/inbound-pipeline.service.ts)
- Центральний pipeline: отримати inbound повідомлення → зберегти → extract memory → згенерувати чернетку → evaluate automation → якщо autosend → відправити
- Якщо не autosend → зберегти як draft + надіслати адміну уведомлення з чернеткою

#### [MODIFY] [ai-orchestrator.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/ai/ai-orchestrator.service.ts)
- Додати метод `processInbound(personaId, candidateId, messageText)` — обгортка для повного pipeline

#### [MODIFY] [forward.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/forward.handler.ts)  
- Після збереження inbound повідомлення — викликати inbound pipeline

---

### Компонент 5: Відправка затверджених чернеток / ручних відповідей

> [!IMPORTANT]
> **Це технічно найскладніший компонент.** Зараз бот працює в режимі «суфлер»: генерує текст, адмін копіює і вставляє вручну. Реальна відправка від імені акаунта потребує або:
> - **(А) Копіювання вручну** — адмін копіює текст, бот просто показує готовий текст ← **вже працює**
> - **(Б) Telegram Bot API** — бот відправляє повідомлення напряму кандидату через свій бот-акаунт ← **можливо, але кандидат бачить що це бот**
> - **(В) MTProto userbot bridge** — потрібна авторизація реального TG-акаунту (telegram-js, gramjs) ← **складно, ризик бану**

На даному етапі рекомендую **варіант А+Б**:
- Чернетка показується адміну з кнопкою «Копіювати» (текст у clipboard) — для основного workflow
- Опціонально, якщо кандидат спілкується напряму з ботом — бот може відправити як `ctx.api.sendMessage(candidateTelegramId, text)`

#### [MODIFY] [messages.service.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/messages/messages.service.ts)
- Метод `approveDraft()` → окрім зняття isDraft, спробувати відправити через bot API якщо кандидат спілкується з ботом

#### [MODIFY] [drafts.panel.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/panels/drafts.panel.ts)
- Після «Отправить» — показати текст у форматі для швидкого копіювання + кнопку «Отправить через бот» (якщо доступно)

---

### Компонент 6: Допрацювання інтерфейсу та missing flows

#### [MODIFY] [lead-detail.panel.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/panels/lead-detail.panel.ts)
- Додати кнопку «💬 Написати вручну» — перехід у flow ручного введення тексту
- Додати кнопку «📥 Переслати повідомлення» — інструкція як переслати повідомлення кандидата в бот
- Показати останнє повідомлення кандидата в картці

#### [MODIFY] [text-message.handler.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/handlers/text-message.handler.ts)
- Додати flow `manual_reply` — адмін пише текст, він зберігається як outbound повідомлення для вибраного кандидата

#### [MODIFY] [media.panel.ts](file:///d:/work/programming/js/web-lady-ai/src/modules/telegram-bot/panels/media.panel.ts)
- Додати кнопку «📤 Відправити кандидату» — вибрати кандидата і відправити медіа

---

## Відповідь на питання про навчання AI

> **Чи зможу я самостійно навчити AI спілкуватись по тим чатам, які ви надасте?**

### ✅ Так, повністю зможу. Ось як це працює:

Система вже має все необхідне для навчання без fine-tuning:

```mermaid
graph LR
    A[JSON-чати] -->|ImportProcessor| B[Style Extractor]
    B -->|Пари: кандидат → відповідь| C[PromptProfile.styleExamples]
    C -->|ContextAssembler| D[Few-shot приклади в промпті]
    D -->|LLM| E[Відповідь у стилі дівчини]
```

**Що вже працює прямо зараз:**
1. **Імпорт чатів** — `ImportProcessor` парсить JSON-експорт з Telegram
2. **Витяг стилю** — `StyleExtractorService` знаходить пари "кандидат написав → дівчина відповіла" і тегує їх
3. **Дедуплікація** — видаляє повтори, зберігає до 120 найкращих прикладів
4. **Зберігання** — пари зберігаються в `PromptProfile.styleExamples`, прив'язаному до конкретної персони
5. **Використання** — `PromptComposerService` вставляє ці приклади в system prompt як few-shot

**Процес навчання для вас:**
1. Ви надаєте JSON-чати (експорт з Telegram Desktop → "Export chat history" → JSON)
2. Кладете їх в папку `chat-examples/` (вже є 4 файли по ~2 МБ)
3. Через бот (або seed-скрипт) запускаєте імпорт, вказуючи яка персона
4. Система автоматично:
   - Визначає хто дівчина, а хто кандидат (по `from_id`)
   - Витягує пари відповідей
   - Тегує їх (знайомство, робота, подорож, гумор, турбота тощо)
   - Зберігає як few-shot приклади в профілі
5. При генерації відповіді AI отримує ці приклади і копіює стиль

**Чим більше якісних чатів — тим точніше стиль.** Рекомендую 5-10 чатів з різними кандидатами для якісного покриття.

**Що я можу допрацювати додатково:**
- Розширити теги (фінанси, заперечення, конфлікти, комплементи)
- Додати фільтрацію «сміттєвих» повідомлень (надто короткі, стікери, реакції)
- Додати вибір релевантних прикладів по ситуації (не всі 120, а 5-10 найрелевантніших до поточного етапу воронки)
- Додати правила заперечень (objection rules) — коли кандидат каже "у мене немає грошей", "це скам" тощо

---

## User Review Required

> [!IMPORTANT]
> **Варіант відправки повідомлень (Компонент 5)**
> Зараз бот працює як «суфлер» — генерує текст, ви копіюєте вручну. Справжня відправка від імені акаунта через MTProto (userbot) — це окремий складний шар, який несе ризик бану акаунта Telegram. На першому етапі рекомендую залишити «суфлер» + опціональну відправку через Bot API (якщо кандидат спілкується напряму з ботом).
> Чи хочете ви впроваджувати MTProto bridge зараз, чи залишити на потім?

> [!IMPORTANT]
> **Пріоритет компонентів**
> Компоненти 1-4 та 6 я можу реалізувати повністю. Компонент 5 (реальна відправка через bridge) — це окреме технічне рішення. Підтвердіть, що ми йдемо в порядку 1→2→3→4→6, а 5 залишаємо в режимі «суфлер + copy».

## Open Questions

> [!WARNING]  
> **`FALLBACK_ADMIN_FROM_ID = '7404772966'`** — це hardcoded ID у `import.processor.ts` та `style-extractor.service.ts`. При імпорті чатів система визначає повідомлення дівчини по цьому ID. Чи правильний цей ID для всіх ваших чатів? Якщо у різних чатах from_id дівчини різний — потрібно передавати його при створенні персони.

## Verification Plan

### Automated Tests
- `npm run build` — перевірка компіляції після кожного компоненту
- Ручний тест через бот: створити персону → імпортувати JSON → перевірити style examples → згенерувати чернетку

### Manual Verification
- Відправити JSON-файл в бот → перевірити що імпорт запустився
- Переслати повідомлення → перевірити що збереглось як inbound + чернетка згенерована
- Відправити фото/відео → перевірити що з'явилось в медіа-бібліотеці
