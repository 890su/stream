import { rmSync } from 'node:fs';
import type { JournalStore } from '../store/store.ts';
import type { LiveFeed } from '../server/live.ts';
import type { SourceState } from '../store/status.ts';
import { captureConfig, whatsappConfig } from '../config.ts';
import { actionChanged, stateChanged } from '../server/system.ts';
import { toItem } from './convert.ts';
import { toEvent } from './ingest.ts';
import type { SocketFactory, WaFiles, WaMessage, WaSocket, WaUpdate } from './types.ts';

// One WhatsApp account as a linked device, inside the server like the Telegram bots
// (docs/plans/2026-11-20-whatsapp-baileys-design.md): keeps the connection, shows the linking QR as the channel's
// state, writes incoming messages and the owner's own messages from the phone to the journal, and sends the owner's
// replies from the feed — by phone, one at a time, never twice. Nothing that happens on the connection may stop
// the server: every handler is isolated, and only ids and states reach the log.

type Info = Record<string, unknown>;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);

export class WhatsAppClient {
  readonly account: string;
  readonly connector: string;
  #store: JournalStore;
  #live: LiveFeed;
  #authDir: string;
  #factory: SocketFactory;
  #retryMs: number;
  #pulseMs: number;
  #delay: number;
  #socket: WaSocket | null = null;
  #qr: string | null = null;
  #running = false;
  #state: [SourceState, string | null, Info] | null = null;
  #timers = new Set<ReturnType<typeof setTimeout>>();
  #open = false;
  #pairing = false;                     // a QR was shown on this connection and not scanned yet
  #idle = false;                        // the QR expired unscanned: no connection until the System screen asks
  #sent = new Set<string>();            // ids of replies sent from the feed: their echo is not a new message
  #wakers = new Set<() => void>();

  constructor({ account, store, live, authDir, factory, retryMs = 5_000, pulseMs = whatsappConfig.pulse_s * 1000 }: {
    account: string; store: JournalStore; live: LiveFeed; authDir: string; factory: SocketFactory; retryMs?: number; pulseMs?: number;
  }) {
    this.account = account;
    this.connector = whatsappConfig.accounts[account]!.connector;
    this.#store = store;
    this.#live = live;
    this.#authDir = authDir;
    this.#factory = factory;
    this.#retryMs = retryMs;
    this.#pulseMs = pulseMs;
    this.#delay = retryMs;
  }

  // The QR to link this device, while WhatsApp waits for it (the System screen shows it).
  get qr(): string | null { return this.#qr; }

  // The System screen asks for the QR: if an unscanned QR expired, connect again for a new one. True if it did.
  requestQr(): boolean {
    if (!this.#idle || !this.#running) return false;
    this.#idle = false;
    this.#later(0);
    return true;
  }

  async start(): Promise<void> {
    this.#running = true;
    for (const action of this.#store.actions.failRunning(this.connector, 'Сервер перезапустился во время отправки — проверьте в WhatsApp, ушло ли сообщение')) {
      actionChanged(this.#store, this.#live, action);
    }
    // The pulse goes on while nothing happens: a quiet connection is not a silent one (System screen).
    const beat = setInterval(() => { if (this.#state) this.#health(...this.#state); }, this.#pulseMs);
    beat.unref();
    this.#timers.add(beat);
    void this.#sendLoop();
    await this.#connect();
  }

  stop(): void {
    this.#running = false;
    this.#open = false;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    for (const wake of [...this.#wakers]) wake();
    this.#socket?.end();
    this.#socket = null;
  }

  async #connect(): Promise<void> {
    if (!this.#running) return;
    let socket: WaSocket;
    try { socket = await this.#factory(this.#authDir); }
    catch (error) {
      this.#health('error', `не удалось запустить WhatsApp (${messageOf(error)})`, { qr: false });
      this.#later(this.#backoff());
      return;
    }
    if (!this.#running) { socket.end(); return; }
    this.#socket = socket;
    socket.onUpdate((update) => {
      try { this.#onUpdate(socket, update); }
      catch (error) { console.error(`WhatsApp ${this.account}: update failed — ${messageOf(error)}`); }
    });
    socket.onMessages((upsert) => this.#onMessages(socket, upsert.messages, whatsappConfig.max_age_h));
    // The history sent at linking: only its last hours (owner's decision 2026-11-20), the same way as live messages.
    socket.onHistory((messages) => this.#onMessages(socket, messages, whatsappConfig.history_h));
  }

  #onUpdate(socket: WaSocket, update: WaUpdate): void {
    if (socket !== this.#socket) return;     // an old connection's last words
    if (update.qr) {
      this.#qr = update.qr;
      this.#pairing = true;
      this.#health('login_required', 'отсканируйте QR на экране «Система»: WhatsApp → Связанные устройства', { qr: true, qr_refresh_s: whatsappConfig.qr_refresh_s });
    }
    if (update.connection === 'open') {
      this.#qr = null;
      this.#open = true;
      this.#pairing = false;
      this.#idle = false;
      this.#delay = this.#retryMs;
      console.log(`WhatsApp ${this.account}: connected`);
      this.#health('ok', null, { qr: false });
    }
    if (update.connection !== 'close') return;
    const pairing = this.#pairing;
    this.#open = false;
    this.#pairing = false;
    this.#qr = null;
    this.#socket = null;
    try { socket.end(); } catch { /* already gone */ }
    // The next connection is scheduled before anything else here can fail: WhatsApp must not stay dead.
    if (update.loggedOut) {
      // The phone unlinked this device: its keys are useless now; a new connection shows a new QR.
      this.#later(this.#retryMs);
      console.log(`WhatsApp ${this.account}: unlinked`);
      try { rmSync(this.#authDir, { recursive: true, force: true }); }
      catch (error) { console.error(`WhatsApp ${this.account}: removing keys failed — ${messageOf(error)}`); }
      this.#health('login_required', 'устройство отвязано — отсканируйте новый QR на экране «Система»', { qr: false });
    } else if (update.restart) {
      this.#later(0);                        // WhatsApp asks for a new connection (right after linking): not an error
    } else if (pairing) {
      // The QR was not scanned in time and WhatsApp closed the pairing. No error and no reconnects every few minutes
      // (each would write two notes to the journal): wait quietly until the System screen asks for a QR.
      this.#idle = true;
      console.log(`WhatsApp ${this.account}: QR expired, waiting for the System screen`);
    } else {
      this.#later(this.#backoff());
      this.#health('error', `нет связи с WhatsApp (${update.reason ?? 'соединение закрыто'})`, { qr: false });
    }
  }

  async #onMessages(socket: WaSocket, messages: WaMessage[], hours: number): Promise<void> {
    const files = this.#files(socket);
    const oldest = Date.now() - hours * 3_600_000;
    for (const message of messages) {
      let id = '?';
      try {
        id = message.key?.id ?? '?';
        const item = await toItem(message, files, (lid) => socket.pnForLid(lid));
        if (!item || Date.parse(item.date) < oldest) continue;
        if (item.out && this.#sent.has(item.id)) continue;   // the echo of a reply sent from the feed
        const event = toEvent(item, this.account);
        if (this.#store.getEvent(event.id)) continue;   // delivered again (reconnect, `append` after `notify`)
        const result = this.#store.appendEvent(event);
        if (result.created) {
          this.#live.publish(result.event);
          this.#store.status.seen(this.connector, result.event.received_at!);
        }
      } catch (error) {
        console.error(`WhatsApp ${this.account}: message failed (${id}) — ${error instanceof Error ? error.name : 'error'}`);
      }
    }
  }

  // One approved reply. While the connection is coming back, replies wait in the queue; while the channel needs the
  // owner (QR, unlinked), they fail with a hint — nothing goes out late after relinking. A send is not idempotent on
  // WhatsApp's side, so a doubtful one is never repeated.
  async #send(): Promise<boolean> {
    const needsOwner = this.#state?.[0] === 'login_required';
    if (!this.#open && !needsOwner) return false;
    const action = this.#store.actions.take(this.connector);
    if (!action) return false;
    const params = action.params as { chat_id: string; text: string };
    const finish = (status: 'done' | 'failed', externalId: string | null, error: string | null) => {
      console.log(`WhatsApp ${this.account}: reply ${action.id} ${status === 'done' ? 'sent' : 'failed'}`);
      actionChanged(this.#store, this.#live, this.#store.actions.finish(action.id, this.connector, status, externalId, error).action);
    };
    const socket = this.#socket;
    if (!this.#open || !socket) { finish('failed', null, 'WhatsApp не подключён — отсканируйте QR на экране «Система»'); return true; }
    let id: string;
    try { id = await socket.sendText(`${params.chat_id.slice(1)}@s.whatsapp.net`, params.text); }
    catch { finish('failed', null, 'Нет ответа от WhatsApp — проверьте в WhatsApp, ушло ли сообщение'); return true; }
    this.#sent.add(id);
    if (this.#sent.size > 500) this.#sent.delete(this.#sent.values().next().value!);
    finish('done', `${params.chat_id}:${id}`, null);
    return true;
  }

  async #sendLoop(): Promise<void> {
    while (this.#running) {
      try { if (await this.#send()) continue; }
      catch (error) { console.error(`WhatsApp ${this.account}: send failed — ${messageOf(error)}`); }
      await this.#sleep(1_000);
    }
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => { clearTimeout(timer); this.#wakers.delete(wake); resolve(); };
      const timer = setTimeout(wake, ms);
      timer.unref();
      this.#wakers.add(wake);
    });
  }

  #files(socket: WaSocket): WaFiles {
    return {
      limit: Math.min(whatsappConfig.media_max_bytes, captureConfig.max_media_bytes),
      allowed: (mime) => captureConfig.mime_types.some((type) => type.endsWith('/*') ? mime.startsWith(type.slice(0, -1)) : mime === type),
      download: (message) => socket.download(message),
      store: (sha, mime, bytes) => { this.#store.putMedia(sha, mime, bytes); },
    };
  }

  #health(state: SourceState, detail: string | null, info: Info): void {
    this.#state = [state, detail, info];
    const previous = this.#store.status.pulse(this.connector, state, detail, info, new Date().toISOString());
    stateChanged(this.#store, this.#live, this.connector, state, previous, detail);
  }

  #backoff(): number {
    const delay = this.#delay;
    this.#delay = Math.min(this.#delay * 2, whatsappConfig.reconnect_max_s * 1000);
    return delay;
  }

  #later(ms: number): void {
    if (!this.#running) return;
    const timer = setTimeout(() => { this.#timers.delete(timer); void this.#connect(); }, ms);
    timer.unref();
    this.#timers.add(timer);
  }
}
