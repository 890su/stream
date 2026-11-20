# WhatsApp (PL) через Baileys — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WhatsApp PL владельца в Stream: входящие и свои исходящие с телефона — в беседе номера, ответ из ленты, состояние канала и привязка по QR на «Системе».

**Architecture:** Baileys работает связанным устройством внутри процесса Stream, как боты Telegram: `WhatsAppClient` создаётся в `createApp`, пишет события прямо в журнал, держит пульс канала и берёт ответы как действия коннектора `whatsapp_pl`. Baileys импортирует только адаптер `src/whatsapp/socket.ts`; клиент и чистый конвертер работают через узкий интерфейс `WaSocket`, тесты подставляют поддельный сокет. Беседы, участники и ответ по номеру — по образцу Viber.

**Tech Stack:** Node 24 (TypeScript без сборки, ESM), `node:sqlite`, `node:test`; `baileys` 7.0.0-rc14, `qrcode` 1.5.4; клиент — ES-модули `web/*.js` без сборщика.

**Spec:** `docs/plans/2026-11-20-whatsapp-baileys-design.md`

## Global Constraints

- Зависимости точными версиями (`pnpm add -E`): `baileys@7.0.0-rc14`, `qrcode@1.5.4`. Без `pino`, превью ссылок, sharp/jimp.
- `baileys` импортирует только `src/whatsapp/socket.ts`; остальной код получает сокет через `SocketFactory` (в `http.ts` — динамическим `import()`), чтобы тесты не грузили Baileys.
- Параметры сокета: `markOnlineOnConnect: false`, `emitOwnEvents: false`, `syncFullHistory: false`, `shouldSyncHistoryMessage: () => false`, `generateHighQualityLinkPreview: false`.
- Только личные чаты: адреса `@s.whatsapp.net` и `@lid`; `@g.us`, `@broadcast`, `@newsletter` пропускаются.
- Ответ — только по номеру `^\+[0-9]{6,15}$`, класс C, без повторов сомнительной отправки.
- Ключи сессии — `<DATA_DIR>/whatsapp/<account>/`, никогда не в git (`data/` уже в `.gitignore`).
- Включение — `STREAM_WA_<ACCOUNT>_ENABLED=1` (например `STREAM_WA_PL_ENABLED=1`) для аккаунтов из `registry/whatsapp.json`.
- `registry/whatsapp.json`: `accounts.pl = { title: "WhatsApp PL", connector: "whatsapp_pl", sphere: "work_pl", timezone: "Europe/Warsaw" }`, `media_max_bytes: 20971520`, `max_age_h: 48`, `reconnect_max_s: 120`, `qr_refresh_s: 15`. Коннектор аккаунта обязан быть `whatsapp_<ключ>` (проверка при загрузке).
- Содержимое сообщений не пишем в журнал сервера — только аккаунт, тип, id.
- Текст для владельца — по-русски; код, идентификаторы, коммиты — по-английски; заголовок-комментарий файла на английском; файл до ~300 строк.
- Тесты одного файла: `node --disable-warning=ExperimentalWarning --test --test-concurrency=1 test/<file>.test.ts`; всё: `pnpm test` (известные нестабильные — повторить серийно), `pnpm typecheck`.
- Коммиты заканчиваются строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Повторная доставка** (после переподключения то же сообщение приходит снова, `notify` и затем `append`) — ровно одно событие. Тест — Task 4.
2. **Отправитель только с LID** (нет `remoteJidAlt`, нет записи в кэше) — событие без номера, беседа `wa:<jid>`, ответ из ленты отклоняется с русской подсказкой. Тесты — Task 2 и Task 6.
3. **Владелец отвязал устройство на телефоне** (`loggedOut`) — ключи стёрты, `login_required` с новым QR, без лавины переподключений. Тест — Task 4.
4. **Странное или битое сообщение / исключение в обработчике** — сервер продолжает работать (`/healthz` 200), в журнал — без содержимого. Тест — Task 4.
5. **Ответ из ленты не возвращается вторым «моим» сообщением** (эхо с тем же id). Тест — Task 5.

---

### Task 1: Реестр, конфиг и контракты событий WhatsApp

**Files:**
- Create: `registry/whatsapp.json`
- Modify: `src/config.ts` (добавить `whatsappConfig` после `telegramConfig`)
- Modify: `contracts/event.schema.json` (описание `source` — добавить `whatsapp`; объект `data.whatsapp` рядом с `data.viber`; описание `outbound` — упомянуть `whatsapp_*`)
- Create: `src/contracts/whatsapp.ts`
- Modify: `src/contracts/telegram.ts:28` (пропускать коннекторы `whatsapp_*`)
- Modify: `src/store/store.ts:12,85` (вызвать `checkWhatsapp` после `checkViber`)
- Modify: `registry/connectors.yaml` (запись `whatsapp_pl` по образцу `telegram_pl`: `operations: [send_message]`, `irreversible: [send_message]`, заметка про класс C и только ответы по номеру)
- Test: `test/whatsapp-contract.test.ts`

**Interfaces:**
- Produces: `whatsappConfig: { version: number; accounts: Record<string, { title: string; connector: string; sphere: string; timezone: string }>; media_max_bytes: number; max_age_h: number; reconnect_max_s: number; qr_refresh_s: number }` — при загрузке бросает `Error`, если `connector !== 'whatsapp_' + ключ`.
- Produces: `WHATSAPP_SOURCE = 'whatsapp'`; `whatsappAccountOf(connector: string): string | undefined` (`'whatsapp_pl'` → `'pl'`, чужой → `undefined`); `checkWhatsapp(event: JournalEvent): void` (бросает `HttpError(400, …)`).
- Produces (схема): `data.whatsapp = { account: string /^[a-z]{2,8}$/; chat: string 1..200; jid: string /^[0-9]+@(s\.whatsapp\.net|lid)$/; phone?: string /^\+[0-9]{6,15}$/; received_at: date-time }`, `required: [account, chat, jid, received_at]`, `additionalProperties: false`.

- [ ] **Step 1: Write the failing tests** — `checkWhatsapp` и `checkTelegram` вызываются напрямую; счастливый путь — через `temporaryStore().store.appendEvent`.

```ts
const wa = { account: 'pl', chat: 'Anna', jid: '48500000001@s.whatsapp.net', phone: '+48500000001', received_at: '2026-11-20T10:00:00.000Z' };
const msg = event({ source: 'whatsapp', author: 'contact:whatsapp:+48500000001', kind: 'text', payload: { text: 'Cześć', data: { whatsapp: wa } } });
test('a WhatsApp message with data.whatsapp is written', ...)            // appendEvent(msg).created === true
test('data.whatsapp only with source whatsapp', ...)                     // checkWhatsapp({...msg, source: 'app'}) throws /source: whatsapp/
test('a whatsapp message needs data.whatsapp', ...)                      // source whatsapp, data {} → throws
test('a WhatsApp message is text, voice, photo or file', ...)            // kind 'call' → throws; 'voice' ok
test('an unknown WhatsApp account is refused', ...)                      // account 'xx' → throws /аккаунт/
test('a LID address without a phone is valid', ...)                      // jid '123456789012345@lid', no phone → no throw
test('a reply to WhatsApp goes only to a phone', ...)                    // outbound {connector:'whatsapp_pl', chat_id:'+48500000001'} ok in checkTelegram and checkWhatsapp; chat_id '12345' → checkWhatsapp throws /номер/
test('whatsappAccountOf maps connectors', ...)                           // 'whatsapp_pl' → 'pl'; 'telegram_pl' → undefined
```

- [ ] **Step 2: Run to verify they fail** — `node --disable-warning=ExperimentalWarning --test --test-concurrency=1 test/whatsapp-contract.test.ts`; Expected: FAIL (`Cannot find module '../src/contracts/whatsapp.ts'`).
- [ ] **Step 3: Add `registry/whatsapp.json` and `whatsappConfig`** with the values from Global Constraints and the connector-name assertion.
- [ ] **Step 4: Add `data.whatsapp` to the schema and `src/contracts/whatsapp.ts`** — `checkWhatsapp` по образцу `checkViber`: сообщения — Russian errors («payload.data.whatsapp бывает только у source: whatsapp», «Сообщение WhatsApp — это text, voice, photo или file», «Неизвестный аккаунт WhatsApp», «Ответ в WhatsApp — только по номеру телефона»). В `checkTelegram` условие становится `!connectorAccount(connector) && connector !== 'viber' && !whatsappAccountOf(connector)`. В `store.appendEvent` — `checkWhatsapp(input)` после `checkViber(input)`.
- [ ] **Step 5: Add `whatsapp_pl` to `registry/connectors.yaml`.**
- [ ] **Step 6: Run the tests** — Expected: PASS; `pnpm typecheck` — без ошибок.
- [ ] **Step 7: Commit** — `git add registry/whatsapp.json registry/connectors.yaml src/config.ts contracts/event.schema.json src/contracts/whatsapp.ts src/contracts/telegram.ts src/store/store.ts test/whatsapp-contract.test.ts && git commit -m "WhatsApp: registry, config and event contract (data.whatsapp, replies by phone)"`

---

### Task 2: Типы и чистый конвертер сообщения Baileys → item

**Files:**
- Create: `src/whatsapp/types.ts`
- Create: `src/whatsapp/convert.ts`
- Test: `test/whatsapp-convert.test.ts`

**Interfaces:**
- Produces (`types.ts`, без импорта `baileys`):

```ts
export interface WaKey { remoteJid?: string | null; remoteJidAlt?: string | null; fromMe?: boolean | null; id?: string | null }
export interface WaMessage { key: WaKey; message?: Record<string, any> | null; messageTimestamp?: number | { toNumber(): number } | null; pushName?: string | null }
export type WaUpdate = { connection?: 'open' | 'close' | 'connecting'; qr?: string; loggedOut?: boolean; reason?: string };
export interface WaSocket {
  onUpdate(fn: (update: WaUpdate) => void): void;
  onMessages(fn: (upsert: { messages: WaMessage[]; type: string }) => Promise<void>): void;
  sendText(jid: string, text: string): Promise<string>;      // id отправленного сообщения
  download(message: WaMessage): Promise<Buffer>;
  pnForLid(lid: string): Promise<string | null>;
  end(): void;
}
export type SocketFactory = (authDir: string) => Promise<WaSocket>;
export interface WaFiles { limit: number; allowed(mime: string): boolean; download(message: WaMessage): Promise<Buffer>; store(sha256: string, mime: string, bytes: Buffer): void }
export interface WaItem { id: string; jid: string; phone?: string; chat: string; out: boolean; date: string; kind: 'text' | 'voice' | 'photo' | 'file'; text: string; media?: MediaRef[] }
```

- Produces (`convert.ts`): `bareJid(jid: string): string` (убирает `:<device>` перед `@`); `phoneOfJid(jid: string): string | undefined` (`'48500000001@s.whatsapp.net'` → `'+48500000001'`, иначе `undefined`); `toItem(message: WaMessage, files: WaFiles, pnForLid: (lid: string) => Promise<string | null>): Promise<WaItem | null>`.

Правила `toItem` (зафиксированы спекой):
- `null`: нет `key.remoteJid` или `key.id`; адрес оканчивается на `@g.us`, `@broadcast`, `@newsletter`; после разворачивания содержимое — только `protocolMessage`, `reactionMessage`, `stickerMessage`, `senderKeyDistributionMessage`, `pollUpdateMessage`, `editedMessage`; нет ни текста, ни файла.
- Разворачивание: пока верхний ключ — `ephemeralMessage`, `viewOnceMessage`, `viewOnceMessageV2`, `viewOnceMessageV2Extension`, `documentWithCaptionMessage`, брать его `.message`.
- `phone`: первый из `remoteJid`, `remoteJidAlt`, дающий `phoneOfJid`; иначе, если `remoteJid` — `@lid`, то `phoneOfJid(bareJid(await pnForLid(bareJid(remoteJid))))`; иначе нет.
- `jid = bareJid(remoteJid)`; `out = Boolean(fromMe)`; `chat` = для своих: `phone ?? jid-до-@`; для входящих: `pushName.trim() || phone || jid-до-@`; обрезать до 200.
- `date`: секунды `messageTimestamp` (число или `.toNumber()`) → ISO; нет — текущее время.
- Текст: `conversation` | `extendedTextMessage.text` | подпись `imageMessage`/`videoMessage`/`documentMessage`; `locationMessage` → `📍 <lat>, <lon>` (5 знаков); `contactMessage` → `👤 <displayName>`.
- Файл: `imageMessage` → `photo` (mime по умолчанию `image/jpeg`); `audioMessage` → `ptt ? 'voice' : 'file'` (`audio/ogg`); `videoMessage` → `file` (`video/mp4`); `documentMessage` → `photo` для `image/*`, иначе `file` (имя — `fileName`). mime нормализуется `split(';')[0].trim().toLowerCase()`; размер — `Number(fileLength)`.
- Пропуск файла (не принят `allowed`, больше `limit`, ошибка `download`) — `kind: 'text'`, к тексту добавляется строка `[файл «<имя или mime>» не загружен: <такой тип не принимается | больше <N> МБ | ошибка загрузки>]`.
- Загружен — `files.store(sha256, mime, bytes)`, `media: [{ media_id, mime, size_bytes, duration_s? (из .seconds для аудио) }]`.

- [ ] **Step 1: Write the failing tests** — простые объекты, поддельные `files` (запоминают `store`) и `pnForLid`.

```ts
test('an incoming text from a phone address', ...)      // jid '48500000001@s.whatsapp.net', pushName 'Anna' → {phone:'+48500000001', chat:'Anna', out:false, kind:'text', text:'Cześć'}
test('a LID address takes the phone from remoteJidAlt', ...)   // remoteJid '1234@lid', remoteJidAlt '48500000001@s.whatsapp.net' → phone '+48500000001', jid '1234@lid'
test('a LID address falls back to the cached mapping', ...)    // no alt; pnForLid('1234@lid') → '48500000001:3@s.whatsapp.net' → phone '+48500000001'
test('an unresolved LID has no phone and keeps the name', ...)  // pnForLid → null → phone undefined, chat 'Anna'
test('my own message from the phone is out', ...)        // fromMe true → out true, chat '+48500000001'
test('groups, status and channels are skipped', ...)     // '@g.us', 'status@broadcast', '@newsletter' → null
test('reactions, stickers, edits and service messages are skipped', ...)  // each → null
test('a photo with a caption is stored', ...)            // imageMessage {mimetype:'image/jpeg', caption:'Zdjęcie'} → kind 'photo', text 'Zdjęcie', media[0].media_id === sha256(bytes), files.store called once
test('a voice note is voice', ...)                       // audioMessage {ptt:true, mimetype:'audio/ogg; codecs=opus', seconds:7} → kind 'voice', media[0].mime 'audio/ogg', duration_s 7
test('a document keeps its name and a too large one becomes a note', ...)  // fileLength > limit → kind 'text', text matches /не загружен: больше 20 МБ/
test('a failed download becomes a note', ...)            // download rejects → kind 'text', /ошибка загрузки/
test('wrappers are unwrapped and the device suffix dropped', ...)  // ephemeralMessage→extendedTextMessage; remoteJid '48500000001:12@s.whatsapp.net' → jid '48500000001@s.whatsapp.net'
test('a timestamp as Long is read', ...)                 // { toNumber: () => 1763632800 } → date '2025-11-20T10:00:00.000Z'
```

- [ ] **Step 2: Run to verify they fail** — `node --disable-warning=ExperimentalWarning --test --test-concurrency=1 test/whatsapp-convert.test.ts`; Expected: FAIL (module not found).
- [ ] **Step 3: Implement `src/whatsapp/types.ts` and `src/whatsapp/convert.ts`** per the rules above (по образцу `src/telegram/convert.ts`: чистая функция, файлы — через колбэки).
- [ ] **Step 4: Run the tests** — Expected: PASS; `pnpm typecheck` — без ошибок.
- [ ] **Step 5: Commit** — `git add src/whatsapp/types.ts src/whatsapp/convert.ts test/whatsapp-convert.test.ts && git commit -m "WhatsApp: message converter (LID → phone, media, skipped kinds)"`

---

### Task 3: Адаптер Baileys

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (`pnpm add -E baileys@7.0.0-rc14`)
- Create: `src/whatsapp/socket.ts`
- Test: `test/whatsapp-socket.test.ts`

**Interfaces:**
- Consumes: `WaSocket`, `WaUpdate`, `WaMessage`, `SocketFactory` из `src/whatsapp/types.ts`.
- Produces: `createSocket: SocketFactory`; `updateOf(update: { connection?: string; qr?: string; lastDisconnect?: { error?: unknown } }): WaUpdate` — чистое: `loggedOut` = код `lastDisconnect.error.output.statusCode === DisconnectReason.loggedOut`, `reason` = сообщение ошибки (до 120 символов).

- [ ] **Step 1: Install the dependency** — `pnpm add -E baileys@7.0.0-rc14`. Предупреждение pnpm о пропущенных build-скриптах допустимо; Expected: в `package.json` — `"baileys": "7.0.0-rc14"`.
- [ ] **Step 2: Write the failing tests**

```ts
test('updateOf: logged out is 401', ...)        // {connection:'close', lastDisconnect:{error:{output:{statusCode:401}, message:'logged out'}}} → {connection:'close', loggedOut:true, reason:'logged out'}
test('updateOf: a restart is not a logout', ...) // statusCode 515 → loggedOut false
test('updateOf: the QR passes through', ...)    // {qr:'2@abc'} → {qr:'2@abc', loggedOut:false}
test('createSocket is a socket factory', ...)   // typeof createSocket === 'function' (модуль грузится в Node 24 — Baileys ESM + WebAssembly)
```

- [ ] **Step 3: Run to verify they fail** — `node --disable-warning=ExperimentalWarning --test --test-concurrency=1 test/whatsapp-socket.test.ts`; Expected: FAIL (module not found).
- [ ] **Step 4: Implement `src/whatsapp/socket.ts`** — `useMultiFileAuthState(authDir)` (каталог создаётся `mkdir -p`), `fetchLatestBaileysVersion()` с `catch` → без версии, `makeWASocket` с параметрами из Global Constraints, `browser: Browsers.ubuntu('Stream')`, тихий логгер — объект `{ level: 'warn', child() { return this }, trace(){}, debug(){}, info(){}, warn(o, m) { console.warn('WhatsApp:', m ?? '') }, error(o, m) { console.error('WhatsApp:', m ?? '') } }` (без объектов — в них бывает содержимое); `creds.update` → `saveCreds`. Адаптер: `onUpdate` → `ev.on('connection.update', u => fn(updateOf(u)))`; `onMessages` → `ev.on('messages.upsert', u => void fn(u))`; `sendText` → `(await sock.sendMessage(jid, { text })).key.id`; `download` → `downloadMediaMessage(message, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage })`; `pnForLid` → `sock.signalRepository.lidMapping.getPNForLID(lid)`; `end` → `sock.end(undefined)`.
- [ ] **Step 5: Run the tests** — Expected: PASS; `pnpm typecheck` — без ошибок.
- [ ] **Step 6: Commit** — `git add package.json pnpm-lock.yaml src/whatsapp/socket.ts test/whatsapp-socket.test.ts && git commit -m "WhatsApp: Baileys socket adapter (linked device, quiet logger, no online presence)"`

---

### Task 4: Клиент WhatsApp — соединение, QR, входящие и свои сообщения

**Files:**
- Create: `src/whatsapp/ingest.ts`
- Create: `src/whatsapp/client.ts`
- Create: `src/server/whatsapp.ts`
- Modify: `src/server/http.ts` (опция `whatsapp`, клиенты, старт/стоп, маршрут QR)
- Modify: `src/server/system.ts:18-22` (`sourceTitle` — заголовок из `whatsappConfig` для `whatsapp_*`)
- Modify: `src/main.ts` (аккаунты из `STREAM_WA_<ACCOUNT>_ENABLED`, `authRoot = resolve(DATA_DIR || 'data', 'whatsapp')`)
- Modify: `package.json`, `pnpm-lock.yaml` (`pnpm add -E qrcode@1.5.4`)
- Modify: `test/helpers.ts` (опция `whatsapp` у `fixture`)
- Create: `test/fakewa.ts` (поддельный сокет и `waitFor`)
- Test: `test/whatsapp.test.ts`

**Interfaces:**
- Consumes: `toItem`, `WaItem`, `WaSocket`, `SocketFactory` (Task 2); `whatsappConfig` (Task 1); `createSocket` (Task 3) — только через `import('../whatsapp/socket.ts')` в `http.ts`.
- Produces (`ingest.ts`): `toEvent(item: WaItem, account: string): JournalEvent` — `id: nameId(\`whatsapp|${account}|${item.out ? 'out' : 'in'}|${item.id}\`)`, `source: 'whatsapp'`, `author: item.out ? 'me' : \`contact:whatsapp:${item.phone ?? item.chat}\``, `ts: item.date`, `kind`, `payload: { text? (если не пусто), media?, data: { whatsapp: { account, chat, jid, phone?, received_at: item.date } } }`.
- Produces (`client.ts`): `class WhatsAppClient { constructor(o: { account: string; store: JournalStore; live: LiveFeed; authDir: string; factory: SocketFactory; retryMs?: number }); readonly account: string; readonly connector: string; get qr(): string | null; start(): Promise<void>; stop(): void }` (`retryMs` по умолчанию 5000; тесты — 10).
- Produces (`server/whatsapp.ts`): `whatsappQr(response: ServerResponse, client: WhatsAppClient | undefined): Promise<void>` — PNG `QRCode.toBuffer(qr, { type: 'png', margin: 2, width: 320 })`, `Content-Type: image/png`, `Cache-Control: no-store`; нет клиента или QR — `HttpError(404, 'QR нет: WhatsApp уже подключён или ещё не запросил вход')`.
- Produces (`http.ts`): `createApp({ …, whatsapp?: { accounts: string[]; authRoot: string; factory?: SocketFactory; retryMs?: number } })` (`retryMs` передаётся клиентам); маршрут `GET /api/whatsapp/<account>/qr` (`/^\/api\/whatsapp\/([a-z]{2,8})\/qr$/`) под токеном владельца.
- Produces (`test/fakewa.ts`): `fakeWa(): { factory: SocketFactory; sockets: FakeSocket[]; last(): FakeSocket; dirs: string[] }`; `FakeSocket` — `emitUpdate(u: WaUpdate): void`, `emitMessages(messages: WaMessage[], type?: string): Promise<void>`, `sent: { jid: string; text: string }[]`, `failSend: boolean`, `pn: Map<string, string>`, `ended: boolean`; `waitFor(check: () => boolean, ms = 2000): Promise<void>`.

Поведение клиента (зафиксировано спекой):
- `start()`: `failRunning(connector, 'Сервер перезапустился во время отправки — проверьте в WhatsApp, ушло ли сообщение')` → `actionChanged`; затем подключение `factory(authDir)` и подписка.
- `qr` → запомнить; пульс `login_required`, деталь `отсканируйте QR на экране «Система»: WhatsApp → Связанные устройства`, `info: { qr: true, qr_refresh_s }`.
- `connection: 'open'` → QR сбросить; пульс `ok`, `info: { qr: false }`; задержка переподключения — к `retryMs`.
- `connection: 'close'` + `loggedOut` → `rmSync(authDir, { recursive: true, force: true })`, пульс `login_required` с деталью `устройство отвязано — отсканируйте новый QR на экране «Система»`, новое подключение через `retryMs`.
- `connection: 'close'` иначе → пульс `error`, деталь `нет связи с WhatsApp (<reason>)`, переподключение с удвоением задержки до `reconnect_max_s`.
- Сообщения: каждое — `toItem`; пропуск, если `null` или старше `max_age_h`; запись `toEvent` → `store.appendEvent`; создано → `live.publish` и `store.status.seen(connector, received_at)`. Каждое сообщение — в своём try/catch, в журнал только `WhatsApp <account>: message failed (<id>)`.
- Пульс: `previous = store.status.pulse(connector, state, detail, info, now)`; `stateChanged(store, live, connector, state, previous, detail)`.
- `stop()`: остановить циклы, `socket.end()`.
- `http.ts`: клиенты для `whatsapp.accounts`, которые есть в `whatsappConfig.accounts`; `authDir = join(authRoot, account)`; фабрика по умолчанию — `async (dir) => (await import('../whatsapp/socket.ts')).createSocket(dir)`; старт на `listening`, стоп на `close`, как у ботов Telegram.
- `main.ts`: `accounts = Object.keys(whatsappConfig.accounts).filter(a => process.env[\`STREAM_WA_${a.toUpperCase()}_ENABLED\`] === '1')`; без аккаунтов опция не передаётся.

- [ ] **Step 1: Install qrcode** — `pnpm add -E qrcode@1.5.4`; Expected: `"qrcode": "1.5.4"` в `package.json`.
- [ ] **Step 2: Write `test/fakewa.ts` and extend `fixture`** — `fixture({ whatsapp: { accounts: ['pl'], factory } })` передаёт `createApp` опцию `{ accounts, factory, authRoot: join(directory, 'whatsapp'), retryMs: 10 }`.
- [ ] **Step 3: Write the failing tests** (`test/whatsapp.test.ts`, `fixture` + `fakeWa`)

```ts
test('an incoming message is written once, by phone', ...)
  // emitUpdate({connection:'open'}); emitMessages([text from 48500000001@s.whatsapp.net, id 'A1', pushName 'Anna']) twice ('notify', then 'append')
  // → ровно одно событие source 'whatsapp'; author 'contact:whatsapp:+48500000001'; data.whatsapp {account:'pl', chat:'Anna', phone:'+48500000001'}; status 'whatsapp_pl' state 'ok'
test('my message from the phone is mine, in the same chat', ...)
  // fromMe true to 48500000001@s.whatsapp.net → author 'me', data.whatsapp.phone '+48500000001'
test('an old message is not written', ...)        // messageTimestamp 49 h ago → нет события
test('the QR is shown until the device is linked', ...)
  // emitUpdate({qr:'2@abc'}) → status state 'login_required', info.qr true; GET /api/whatsapp/pl/qr → 200 image/png;
  // system event text matches /WhatsApp PL: нужен вход/; emitUpdate({connection:'open'}) → state 'ok'; GET qr → 404
test('unlinked on the phone: keys removed, a new QR', ...)
  // emitUpdate({connection:'close', loggedOut:true}) → authDir не существует; state 'login_required'; waitFor(sockets.length === 2)
test('a lost connection is an error and reconnects', ...)
  // emitUpdate({connection:'close', reason:'stream errored'}) → state 'error', detail /нет связи с WhatsApp/; waitFor(sockets.length === 2)
test('a broken message does not stop the server', ...)
  // emitMessages([{ key: { remoteJid: '48500000001@s.whatsapp.net', id: 'B1' }, message: { imageMessage: {} } }]) с download, который бросает,
  // и [{ key: {}, message: null }] → без исключения; GET /healthz → 200
test('the QR route needs the owner token', ...)   // без токена → 401
test('without the option no WhatsApp client runs', ...)  // fixture() → GET /api/whatsapp/pl/qr → 404
```

- [ ] **Step 4: Run to verify they fail** — `node --disable-warning=ExperimentalWarning --test --test-concurrency=1 test/whatsapp.test.ts`; Expected: FAIL.
- [ ] **Step 5: Implement `src/whatsapp/ingest.ts`, `src/whatsapp/client.ts`, `src/server/whatsapp.ts`** per the behaviour above (жизненный цикл и `#sleep` — по образцу `TelegramBot`).
- [ ] **Step 6: Wire `http.ts`, `system.ts`, `main.ts`.**
- [ ] **Step 7: Run the tests** — Expected: PASS; затем `pnpm typecheck` и `pnpm test` — зелёные.
- [ ] **Step 8: Commit** — `git add package.json pnpm-lock.yaml src/whatsapp/ingest.ts src/whatsapp/client.ts src/server/whatsapp.ts src/server/http.ts src/server/system.ts src/main.ts test/helpers.ts test/fakewa.ts test/whatsapp.test.ts && git commit -m "WhatsApp: in-process client — linking by QR, channel pulse, incoming and own messages"`

---

### Task 5: Ответы из ленты

**Files:**
- Modify: `src/whatsapp/client.ts` (цикл отправки, память отправленных id)
- Test: `test/whatsapp.test.ts` (дописать)

**Interfaces:**
- Consumes: `WhatsAppClient`, `fakeWa` (Task 4); `store.actions.take/finish/failRunning`, `actionChanged`.
- Produces: внутри клиента `send(): Promise<boolean>` и цикл раз в 1 с, пока работает; множество отправленных id (до 500 последних) — свои сообщения с этими id не пишутся.

Поведение: действие коннектора `whatsapp_pl`, `params.chat_id` — `+номер`, `params.text`. Нет открытого соединения → `failed` «WhatsApp не подключён — экран «Система»». Иначе `sendText(<номер без +>@s.whatsapp.net, text)`; исключение → `failed` «Нет ответа от WhatsApp — проверьте в WhatsApp, ушло ли сообщение» (без повтора); успех → id в память, `done`, `external_id = <chat_id>:<id>`; каждое изменение → `actionChanged`. В журнал — только id действия и итог.

- [ ] **Step 1: Write the failing tests**

```ts
test('a reply goes by phone and is reported', ...)
  // open; POST /api/events ответ владельца {outbound:{connector:'whatsapp_pl', chat_id:'+48500000001', chat_title:'Anna'}, text 'Dzień dobry'}
  // → waitFor(last().sent.length === 1); sent[0] deep-equals {jid:'48500000001@s.whatsapp.net', text:'Dzień dobry'};
  // action status 'done', external_id '+48500000001:<id из sendText>'
test('my reply does not come back as a second message', ...)
  // после отправки emitMessages([fromMe, id = отправленный id]) → число событий source 'whatsapp' не растёт
test('a reply while not connected fails with a hint', ...)   // без 'open' → status 'failed', error /не подключён/
test('a failed send is not repeated', ...)                   // failSend true → 'failed', error /проверьте в WhatsApp/; sent пуст; повторной попытки нет (sent.length остаётся 0 через 100 мс)
test('a send left running by a restart fails on start', ...)
  // temporaryStore(); appendEvent(ответ владельца на whatsapp_pl); store.actions.take('whatsapp_pl') → 'running';
  // затем new WhatsAppClient({ account:'pl', store, live: new LiveFeed(), authDir, factory: fakeWa().factory, retryMs: 10 }).start()
  // → действие 'failed', error /Сервер перезапустился/; client.stop()
test('a reply by name is refused', ...)                      // chat_id 'Anna' → POST /api/events 400
```

- [ ] **Step 2: Run to verify they fail** — Expected: FAIL (ответ не уходит).
- [ ] **Step 3: Implement the send loop in `src/whatsapp/client.ts`** (по образцу `TelegramBot.send` и `#sendLoop`).
- [ ] **Step 4: Run the tests** — Expected: PASS; `pnpm typecheck` — без ошибок.
- [ ] **Step 5: Commit** — `git add src/whatsapp/client.ts test/whatsapp.test.ts && git commit -m "WhatsApp: replies from the feed by phone, never repeated, own echo skipped"`

---

### Task 6: Stream понимает беседы WhatsApp (сервер-разбор и клиент)

**Files:**
- Modify: `src/tasks/parties.ts:18-20`, `web/parties.js:19-21` (`contact:whatsapp:+цифры` → `tel:+…`, иначе `name:…`, как Viber)
- Modify: `src/tasks/triage.ts:32-34` (`streamOf`: `data.whatsapp` → `whatsapp|<phone ?? jid>`; `outbound` `whatsapp_*` → `whatsapp|<chat_id>`)
- Modify: `src/tasks/messages.ts:33-34` (имя собеседника из `data.whatsapp.chat`)
- Modify: `registry/tasks.json` (`quiet_s_by_stream.whatsapp: 180`)
- Modify: `web/projection.js` (`sourceKey` → `'whatsapp'`; `chatOf`: `{ key: \`whatsapp_${account}|${phone ?? jid}\`, account: \`whatsapp_${account}\`, chat_id: phone ?? '', title: chat, group: false }`, для `outbound` `whatsapp_*` — `{ key: \`${connector}|${chat_id}\`, account: connector, chat_id, title: chat_title || chat_id, group: false }`)
- Modify: `web/conversations.js` (`conversationOf`: номер → `tel:+…`, без номера → `wa:<jid>`; `outbound` `whatsapp_*` → `tel:<chat_id>`; `channelOf` → `'whatsapp'`; `titleOf` для `tel:` берёт `data.whatsapp.chat` / `chat_title`; `incomingChat` учитывает `data.whatsapp`)
- Modify: `web/outbound.js` (`replyWindowClosed` → `false` для `whatsapp_*`; `outboundData` → `{ connector: chat.account, chat_id, chat_title }`; `viberAnswerable` переименовать в `phoneAnswerable`: для `viber` и `whatsapp_*` — только номер)
- Modify: `web/composer.js:9,128-135` (`phoneAnswerable`; подпись канала `WhatsApp`; без номера — «<имя>: WhatsApp не показал номер — ответьте в WhatsApp на телефоне»)
- Modify: `web/tgbubble.js` (`accountTitle('whatsapp_pl')` → `'WhatsApp PL'`; `isMessenger` учитывает `data.whatsapp`; `deliveryText` для коннекторов `whatsapp_*` → `'✓ в WhatsApp'`; `messengerLabel` для `data.whatsapp` → `head: 'WhatsApp PL · <chat>[ · <phone>]'`, `incoming: author !== 'me'`)
- Modify: `web/actions.js:10,42`, `web/bubble.js:237` (учитывать `data.whatsapp` как у Viber)
- Modify: `web/convlist.js:9` (`whatsapp: 'WA'`), `web/drawer.js:107,123` (`whatsapp: 'WhatsApp'`)
- Modify: `web/system.js` (строка источника с `info.qr`: картинка QR — `fetch('/api/whatsapp/<account>/qr')` с токеном → `blob` → `URL.createObjectURL`, обновление каждые `info.qr_refresh_s` с, пока окно открыто; старый URL — `revokeObjectURL`; подпись «WhatsApp → Связанные устройства → Привязать устройство»)
- Modify: `test/viber.test.ts:12,139` (импорт `phoneAnswerable` вместо `viberAnswerable`)
- Test: `test/whatsapp-client.test.ts`

**Interfaces:**
- Consumes: форма `data.whatsapp` (Task 1), событие от `toEvent` (Task 4).
- Produces: `phoneAnswerable(chat): boolean` (замена `viberAnswerable`).

- [ ] **Step 1: Write the failing tests** (`test/whatsapp-client.test.ts`, чистые функции)

```ts
const event = { id:'w1', author:'contact:whatsapp:+48500000001', source:'whatsapp', kind:'text', ts:'2026-11-20T10:00:00.000Z',
  payload:{ text:'Cześć', data:{ whatsapp:{ account:'pl', chat:'Anna', jid:'48500000001@s.whatsapp.net', phone:'+48500000001', received_at:'2026-11-20T10:00:00.000Z' } } } };
test('a WhatsApp chat with a phone is that number conversation', ...)
  // chatOf(event) deep-equals {key:'whatsapp_pl|+48500000001', account:'whatsapp_pl', chat_id:'+48500000001', title:'Anna', group:false}
  // conversationOf(event) === 'tel:+48500000001'; sourceKey(event) === 'whatsapp'
test('a reply goes to the whatsapp connector by phone', ...)
  // replyWindowClosed(chat, []) === false; outboundData(chat, undefined, {}) deep-equals {connector:'whatsapp_pl', chat_id:'+48500000001', chat_title:'Anna'}
  // conversationOf(reply with that outbound, author me, source app) === 'tel:+48500000001'
test('without a phone: own conversation, no reply from the feed', ...)
  // data.whatsapp без phone, jid '1234@lid' → conversationOf === 'wa:1234@lid'; phoneAnswerable(chatOf(...)) === false
test('labels say WhatsApp', ...)
  // messengerLabel(event).head === 'WhatsApp PL · Anna · +48500000001'; deliveryText({status:'done', connector:'whatsapp_pl'}) === '✓ в WhatsApp'
test('the sender is one party with their calls; the stream is the phone', ...)
  // partyOf('contact:whatsapp:+48500000001') === 'tel:+48500000001'; partyOf('contact:whatsapp:Anna') === 'name:Anna'
  // streamOf(stored event) === 'whatsapp|+48500000001'
test('Viber still answers only by phone', ...)  // phoneAnswerable для viber без номера === false (переименование не сломало)
```

- [ ] **Step 2: Run to verify they fail** — `node --disable-warning=ExperimentalWarning --test --test-concurrency=1 test/whatsapp-client.test.ts`; Expected: FAIL.
- [ ] **Step 3: Implement the server-side changes** (`parties.ts`, `triage.ts`, `messages.ts`, `tasks.json`).
- [ ] **Step 4: Implement the web changes** (all `web/*.js` above, including `system.js` QR).
- [ ] **Step 5: Run the tests** — `test/whatsapp-client.test.ts` и `test/viber.test.ts` — PASS; затем `pnpm test` и `pnpm typecheck` — зелёные.
- [ ] **Step 6: Check the System screen in the browser** — `pnpm start` с `STREAM_WA_PL_ENABLED=1` и пустым `DATA_DIR` во временном каталоге: экран «Система» → строка «WhatsApp PL — нужен вход» с картинкой QR (реальный Baileys запросит QR; сканировать не нужно). Expected: картинка видна, раз в 15 с обновляется, ошибок CSP в консоли нет.
- [ ] **Step 7: Commit** — `git add src/tasks/parties.ts src/tasks/triage.ts src/tasks/messages.ts registry/tasks.json web/projection.js web/conversations.js web/outbound.js web/composer.js web/tgbubble.js web/actions.js web/bubble.js web/convlist.js web/drawer.js web/parties.js web/system.js test/viber.test.ts test/whatsapp-client.test.ts && git commit -m "WhatsApp: conversations by number, replies by phone, labels and QR on the System screen"`

---

### Task 7: Выкладка, привязка и документы

**Files:**
- Modify: `deploy/install.sh:58-62` (после блока Telegram: `grep -Eq '^STREAM_WA_PL_ENABLED=1' "$ENV_FILE" && echo "WhatsApp: PL enabled" || echo "WhatsApp: PL off (set STREAM_WA_PL_ENABLED=1 in $ENV_FILE, deploy/WHATSAPP.md)"`)
- Create: `deploy/WHATSAPP.md` (включение, привязка по QR на «Системе», отвязка, риски, что делать при «нужен вход» / «ошибка»)
- Modify: `decisions.md` (решение 2026-11-20: WhatsApp — Baileys связанным устройством в процессе Stream; LID; риски; отклонённые Cloud API и сайдкар)
- Modify: `docs/CODEMAP.md` (`src/whatsapp/*`, `src/server/whatsapp.ts`, `registry/whatsapp.json`, `deploy/WHATSAPP.md`)
- Modify: `PLAN.md` (In progress — пункт WhatsApp PL с ❓ на неделю использования; Backlog — убрать «WhatsApp PL»)
- Modify: `CONTEXT.md` («Сейчас» — WhatsApp PL; «Где что» — `deploy/WHATSAPP.md`)

- [ ] **Step 1: Write `deploy/WHATSAPP.md` and the install.sh line; update decisions, CODEMAP, PLAN, CONTEXT.**
- [ ] **Step 2: Full check** — `pnpm test` (нестабильные — повторить серийно) и `pnpm typecheck`; Expected: всё зелёное.
- [ ] **Step 3: Commit and push** — `git add deploy/install.sh deploy/WHATSAPP.md decisions.md docs/CODEMAP.md PLAN.md CONTEXT.md && git commit -m "WhatsApp: deploy guide, decision and docs"`; `git push origin step1-journal-capture`.
- [ ] **Step 4: Enable on the server** — `ssh -i ~/.ssh/id_ed25519 admin890brain@192.168.0.149 "grep -q '^STREAM_WA_PL_ENABLED=' /srv/stream/.env || echo 'STREAM_WA_PL_ENABLED=1' | sudo -n tee -a /srv/stream/.env >/dev/null"`; Expected: строка есть в `.env`.
- [ ] **Step 5: Deploy** — `sudo -n bash /srv/stream/app/deploy/install.sh step1-journal-capture` через ssh; Expected: `WhatsApp: PL enabled`, `OK: https://stream.sekond.pl`; `curl https://stream.sekond.pl/healthz` → `{"ok":true}`.
- [ ] **Step 6: Owner links the device** — владелец открывает «Систему», сканирует QR (WhatsApp → Связанные устройства → Привязать устройство). Expected: «WhatsApp PL — работает», событие «WhatsApp PL: работает» в ленте; в журнале контейнера нет содержимого сообщений.
- [ ] **Step 7: Live check with the owner** — входящее с другого номера появляется в беседе номера; сообщение, набранное владельцем на телефоне, — как «моё»; ответ из ленты доходит и показывает «✓ в WhatsApp»; на телефоне продолжают приходить уведомления WhatsApp. Итог — в `PLAN.md`, коммит и пуш.
