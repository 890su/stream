import type { JournalStore } from '../store/store.ts';
import type { LiveFeed } from '../server/live.ts';
import type { SourceState } from '../store/status.ts';
import { captureConfig, telegramConfig } from '../config.ts';
import { nameId } from '../ids.ts';
import { actionChanged, stateChanged, sourceTitle } from '../server/system.ts';
import { ingest, markDeleted } from './ingest.ts';
import { toItem, type Files } from './convert.ts';

// One account bot (CONCEPT.md §8.2): reads its updates (business chats of the connected account and groups it
// was added to) and sends the owner's replies through the business connection. Runs inside the server.

const UPDATES = ['business_connection', 'business_message', 'edited_business_message', 'deleted_business_messages', 'message', 'edited_message', 'my_chat_member'];
const WINDOW_MS = telegramConfig.reply_window_h * 3_600_000;

export class TelegramError extends Error {
  readonly code: number;
  constructor(code: number, message: string) { super(message); this.code = code; }
}

// Russian reasons for the Bot API errors the owner can act on.
export function sendError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/BUSINESS_PEER_USAGE_MISSING|PEER_ID_INVALID|chat not found/i.test(text)) return 'Окно 24 часа закрыто: клиент давно не писал — ответьте в Telegram';
  if (/blocked/i.test(text)) return 'Собеседник заблокировал аккаунт';
  if (/Too Many Requests/i.test(text)) return 'Telegram просит подождать — повторите позже';
  return `Telegram: ${text}`.slice(0, 300);
}

export class TelegramBot {
  readonly account: string;
  readonly connector: string;
  #token: string;
  #api: string;
  #store: JournalStore;
  #live: LiveFeed;
  #offset = 0;
  #running = false;
  #username: string | null = null;
  #wakers = new Set<() => void>();
  #abort = new AbortController();

  constructor({ account, token, store, live, apiBase = 'https://api.telegram.org' }: { account: string; token: string; store: JournalStore; live: LiveFeed; apiBase?: string }) {
    this.account = account;
    this.connector = telegramConfig.accounts[account]!.connector;
    this.#token = token;
    this.#api = apiBase.replace(/\/$/, '');
    this.#store = store;
    this.#live = live;
  }

  get username() { return this.#username; }

  async call(method: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<any> {
    const response = await fetch(`${this.#api}/bot${this.#token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), this.#abort.signal]),
    });
    const body = await response.json().catch(() => ({})) as { ok?: boolean; result?: unknown; description?: string; error_code?: number };
    if (!body.ok) throw new TelegramError(body.error_code ?? response.status, body.description ?? `HTTP ${response.status}`);
    return body.result;
  }

  #files(): Files {
    return {
      limit: Math.min(telegramConfig.media_max_bytes, captureConfig.max_media_bytes),
      allowed: (mime) => captureConfig.mime_types.some((type) => type.endsWith('/*') ? mime.startsWith(type.slice(0, -1)) : mime === type),
      download: async (fileId) => {
        const file = await this.call('getFile', { file_id: fileId });
        const response = await fetch(`${this.#api}/file/bot${this.#token}/${file.file_path}`, { signal: AbortSignal.timeout(120_000) });
        if (!response.ok) throw new Error(`file ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
      },
      store: (sha, mime, bytes) => { this.#store.putMedia(sha, mime, bytes); },
    };
  }

  #note(text: string, state: SourceState, key: string) {
    const at = new Date().toISOString();
    const result = this.#store.appendEvent({
      id: nameId(`tg-note|${this.account}|${key}`), schema_version: 1, source: 'system', author: 'system', ts: at, kind: 'system',
      payload: { text: `${sourceTitle(this.connector)}: ${text}`, data: { system: { source: this.connector, state } } },
    });
    if (result.created) this.#live.publish(result.event);
  }

  #health(state: SourceState, detail: string | null) {
    const groups = this.#store.connections.groups().filter((group) => group.account === this.account && group.allowed).length;
    const previous = this.#store.status.pulse(this.connector, state, detail, { bot: this.#username, groups }, new Date().toISOString());
    stateChanged(this.#store, this.#live, this.connector, state, previous, detail);
  }

  // The bot's own state: connected and trusted → ok; otherwise what the owner has to do.
  #state(): [SourceState, string | null] {
    if (this.#store.connections.active(this.account)) return ['ok', null];
    const pending = this.#store.connections.list().some((item) => item.account === this.account && item.enabled && item.trusted === null);
    return ['login_required', pending ? 'подтвердите подключение на экране «Система»'
      : `подключите @${this.#username ?? 'бота'}: Настройки → Telegram для бизнеса → Чат-боты`];
  }

  async handle(update: Record<string, any>): Promise<void> {
    const connections = this.#store.connections;
    const owners = connections.trusted(this.account);
    if (update.business_connection) {
      const c = update.business_connection;
      const saved = connections.save({
        id: c.id, account: this.account, user_id: String(c.user.id), user_name: [c.user.first_name, c.user.last_name].filter(Boolean).join(' ') || null,
        can_reply: Boolean(c.rights?.can_reply ?? c.can_reply), enabled: Boolean(c.is_enabled),
      });
      if (saved.trusted === null && saved.enabled) this.#note(`подключён аккаунт «${saved.user_name ?? saved.user_id}» — подтвердите на экране «Система»`, 'login_required', `connect|${c.id}|${c.date}`);
      return;
    }
    const business = update.business_message ?? update.edited_business_message;
    if (business) {
      if (!connections.get(business.business_connection_id)?.trusted) return; // someone else's account
      const item = await toItem(business, owners, this.#files(), Boolean(update.edited_business_message));
      if (item) ingest(this.account, [item], this.#store, this.#live);
      return;
    }
    if (update.deleted_business_messages) {
      const d = update.deleted_business_messages;
      if (!connections.get(d.business_connection_id)?.trusted) return;
      markDeleted(this.account, String(d.chat.id), d.message_ids, new Date().toISOString(), this.#store, this.#live);
      return;
    }
    if (update.my_chat_member) {
      // Groups are read while whoever added the bot is a trusted account of this bot (CONCEPT.md §8.2).
      const m = update.my_chat_member;
      const chat = m.chat;
      if (chat.type !== 'group' && chat.type !== 'supergroup') return;
      const active = (status: string | undefined) => status === 'member' || status === 'administrator';
      const member = active(m.new_chat_member?.status);
      const joined = member && !active(m.old_chat_member?.status);
      connections.setGroup(this.account, String(chat.id), chat.title ?? null, joined ? String(m.from?.id) : null, member);
      if (joined && !connections.groupAllowed(this.account, String(chat.id))) {
        const known = connections.list().some((item) => item.account === this.account && item.user_id === String(m.from?.id) && item.trusted !== false);
        this.#note(known ? `бот добавлен в группу «${chat.title}» — она читается, когда вы подтвердите подключение`
          : `бота добавили в группу «${chat.title}» не вы — её сообщения не читаются`, known ? 'login_required' : 'error', `group|${chat.id}|${m.date}`);
      }
      return;
    }
    const message = update.message ?? update.edited_message;
    if (message && (message.chat?.type === 'group' || message.chat?.type === 'supergroup')) {
      if (!connections.groupAllowed(this.account, String(message.chat.id))) return;
      const item = await toItem(message, owners, this.#files(), Boolean(update.edited_message));
      if (item) ingest(this.account, [item], this.#store, this.#live);
    }
    // Private messages to the bot itself are not part of any account's correspondence.
  }

  // Sends one approved reply. Not idempotent on Telegram's side, so a doubtful send is never repeated.
  async send(): Promise<boolean> {
    const action = this.#store.actions.take(this.connector);
    if (!action) return false;
    const params = action.params as { chat_id: string; text: string; reply_to_message_id?: number };
    const fail = (error: string) => actionChanged(this.#store, this.#live, this.#store.actions.finish(action.id, this.connector, 'failed', null, error).action);
    const connection = this.#store.connections.active(this.account);
    if (params.chat_id.startsWith('-')) { fail('В группе ответ из ленты не отправляется: бот писал бы от своего имени — ответьте в Telegram'); return true; }
    if (!connection) { fail('Бот не подключён к аккаунту — экран «Система»'); return true; }
    const last = this.#store.telegram.lastIncomingAt(this.account, params.chat_id);
    if (!last || Date.now() - Date.parse(last) > WINDOW_MS) { fail('Окно 24 часа закрыто: клиент давно не писал — ответьте в Telegram'); return true; }
    let sent: { message_id: number };
    try {
      sent = await this.call('sendMessage', {
        business_connection_id: connection.id, chat_id: Number(params.chat_id), text: params.text,
        ...(params.reply_to_message_id ? { reply_parameters: { message_id: params.reply_to_message_id, allow_sending_without_reply: true } } : {}),
      }, 30_000);
    } catch (error) {
      fail(error instanceof TelegramError ? sendError(error) : 'Нет ответа от Telegram — проверьте в чате, ушло ли сообщение');
      return true;
    }
    actionChanged(this.#store, this.#live, this.#store.actions.finish(action.id, this.connector, 'done', `${params.chat_id}:${sent.message_id}`, null).action);
    return true;
  }

  async #pollOnce(): Promise<void> {
    const updates = await this.call('getUpdates', { offset: this.#offset, timeout: 25, allowed_updates: UPDATES }, 40_000) as Record<string, any>[];
    for (const update of updates) {
      try { await this.handle(update); }
      catch (error) { console.error(`Telegram ${this.account}: update ${update.update_id} failed`, error instanceof Error ? error.message : error); }
      this.#offset = update.update_id + 1;
    }
    this.#health(...this.#state());
  }

  async start(): Promise<void> {
    this.#running = true;
    for (const action of this.#store.actions.failRunning(this.connector, 'Сервер перезапустился во время отправки — проверьте в Telegram, ушло ли сообщение')) actionChanged(this.#store, this.#live, action);
    void this.#sendLoop();
    let delay = 5_000;
    while (this.#running) {
      try {
        if (!this.#username) {
          const me = await this.call('getMe');
          this.#username = me.username;
          if (!me.can_connect_to_business) { this.#health('error', `включите Business Mode у @${me.username} в @BotFather`); await this.#sleep(300_000); this.#username = null; continue; }
        }
        await this.#pollOnce();
        delay = 5_000;
      } catch (error) {
        if (!this.#running) break;
        const unauthorized = error instanceof TelegramError && error.code === 401;
        this.#health('error', unauthorized ? 'токен бота не принят — проверьте его в /srv/stream/.env' : `нет связи с Telegram (${error instanceof Error ? error.message : error})`.slice(0, 300));
        await this.#sleep(unauthorized ? 300_000 : delay);
        delay = Math.min(delay * 2, 120_000);
      }
    }
  }

  async #sendLoop(): Promise<void> {
    while (this.#running) {
      try { if (await this.send()) continue; } catch (error) { console.error(`Telegram ${this.account}: send failed`, error instanceof Error ? error.message : error); }
      await this.#sleep(1_000);
    }
  }

  #sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const wake = () => { clearTimeout(timer); this.#wakers.delete(wake); resolve(); };
      const timer = setTimeout(wake, ms);
      this.#wakers.add(wake);
    });
  }

  stop(): void { this.#running = false; this.#abort.abort(); for (const wake of [...this.#wakers]) wake(); }
}
