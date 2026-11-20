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
// state, writes incoming messages and the owner's own messages from the phone to the journal. Nothing that happens
// on the connection may stop the server: every handler is isolated, and only ids and states reach the log.

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

  async start(): Promise<void> {
    this.#running = true;
    for (const action of this.#store.actions.failRunning(this.connector, 'Сервер перезапустился во время отправки — проверьте в WhatsApp, ушло ли сообщение')) {
      actionChanged(this.#store, this.#live, action);
    }
    // The pulse goes on while nothing happens: a quiet connection is not a silent one (System screen).
    const beat = setInterval(() => { if (this.#state) this.#health(...this.#state); }, this.#pulseMs);
    beat.unref();
    this.#timers.add(beat);
    await this.#connect();
  }

  stop(): void {
    this.#running = false;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
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
    socket.onMessages((upsert) => this.#onMessages(socket, upsert.messages));
  }

  #onUpdate(socket: WaSocket, update: WaUpdate): void {
    if (socket !== this.#socket) return;     // an old connection's last words
    if (update.qr) {
      this.#qr = update.qr;
      this.#health('login_required', 'отсканируйте QR на экране «Система»: WhatsApp → Связанные устройства', { qr: true, qr_refresh_s: whatsappConfig.qr_refresh_s });
    }
    if (update.connection === 'open') {
      this.#qr = null;
      this.#delay = this.#retryMs;
      console.log(`WhatsApp ${this.account}: connected`);
      this.#health('ok', null, { qr: false });
    }
    if (update.connection !== 'close') return;
    this.#socket = null;
    socket.end();
    if (update.loggedOut) {
      // The phone unlinked this device: its keys are useless now; a new connection shows a new QR.
      rmSync(this.#authDir, { recursive: true, force: true });
      this.#qr = null;
      console.log(`WhatsApp ${this.account}: unlinked`);
      this.#health('login_required', 'устройство отвязано — отсканируйте новый QR на экране «Система»', { qr: false });
      this.#later(this.#retryMs);
    } else if (update.restart) {
      this.#later(0);                        // WhatsApp asks for a new connection (right after linking): not an error
    } else {
      this.#health('error', `нет связи с WhatsApp (${update.reason ?? 'соединение закрыто'})`, { qr: false });
      this.#later(this.#backoff());
    }
  }

  async #onMessages(socket: WaSocket, messages: WaMessage[]): Promise<void> {
    const files = this.#files(socket);
    const oldest = Date.now() - whatsappConfig.max_age_h * 3_600_000;
    for (const message of messages) {
      let id = '?';
      try {
        id = message.key?.id ?? '?';
        const item = await toItem(message, files, (lid) => socket.pnForLid(lid));
        if (!item || Date.parse(item.date) < oldest) continue;
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
