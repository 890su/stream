import { mkdirSync } from 'node:fs';
import makeWASocket, { Browsers, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, useMultiFileAuthState, type WAMessage } from 'baileys';
import type { SocketFactory, WaMessage, WaUpdate } from './types.ts';

// The only file that imports Baileys (docs/plans/2026-11-20-whatsapp-baileys-design.md): one linked-device
// connection behind the narrow WaSocket interface. The session keys live in `authDir` (the data volume, never git).
// The connection settings are SOCKET_OPTIONS. The logger prints messages only, never objects: those may carry
// message content.

type Logger = NonNullable<Parameters<typeof makeWASocket>[0]['logger']>;
const say = (obj: unknown, msg?: string) => msg ?? (typeof obj === 'string' ? obj : '');
const quiet: Logger = {
  level: 'warn',
  child: () => quiet,
  trace() {}, debug() {}, info() {},
  warn(obj: unknown, msg?: string) { console.warn('WhatsApp:', say(obj, msg)); },
  error(obj: unknown, msg?: string) { console.error('WhatsApp:', say(obj, msg)); },
};

// How Stream connects: never shown as online (the phone keeps showing WhatsApp notifications), its own sends do not
// come back as messages, no link previews, no full history. Baileys' default history sync (all but FULL) is kept on
// purpose: it carries the LID ↔ phone mappings (Baileys warns that without them sessions break); of the history itself
// (`messaging-history.set`) the client keeps only the last `history_h` hours.
export const SOCKET_OPTIONS = {
  markOnlineOnConnect: false, emitOwnEvents: false, syncFullHistory: false, generateHighQualityLinkPreview: false,
} as const;

// Saving the session keys must never reject unhandled: that would stop the whole server (journal, Telegram, all).
export const saveQuietly = (save: () => Promise<void>) => (): void => {
  save().catch((error: unknown) => console.error('WhatsApp: saving keys failed —', (error as { code?: string } | null)?.code ?? 'error'));
};

// Baileys' connection.update → ours: the state, the QR, whether the phone unlinked this device or WhatsApp asked for
// a new connection (515, right after the QR is scanned), why it closed.
export function updateOf(update: { connection?: string; qr?: string; lastDisconnect?: { error?: unknown } }): WaUpdate {
  const error = update.lastDisconnect?.error as { output?: { statusCode?: number }; message?: string } | undefined;
  const result: WaUpdate = { loggedOut: error?.output?.statusCode === DisconnectReason.loggedOut };
  if (error?.output?.statusCode === DisconnectReason.restartRequired) result.restart = true;
  if (update.connection === 'open' || update.connection === 'close' || update.connection === 'connecting') result.connection = update.connection;
  if (update.qr) result.qr = update.qr;
  if (error?.message) result.reason = String(error.message).slice(0, 120);
  return result;
}

export const createSocket: SocketFactory = async (authDir) => {
  mkdirSync(authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const latest = await fetchLatestBaileysVersion().catch(() => null);
  const sock = makeWASocket({
    ...SOCKET_OPTIONS, auth: state, logger: quiet, browser: Browsers.ubuntu('Stream'), ...(latest?.version ? { version: latest.version } : {}),
  });
  sock.ev.on('creds.update', saveQuietly(saveCreds));
  return {
    onUpdate: (fn) => { sock.ev.on('connection.update', (update) => fn(updateOf(update))); },
    onMessages: (fn) => { sock.ev.on('messages.upsert', (upsert) => { void fn({ messages: upsert.messages as unknown as WaMessage[], type: upsert.type }); }); },
    onHistory: (fn) => { sock.ev.on('messaging-history.set', (history) => { void fn((history.messages ?? []) as unknown as WaMessage[]); }); },
    sendText: async (jid, text) => {
      const sent = await sock.sendMessage(jid, { text });
      if (!sent?.key.id) throw new Error('WhatsApp did not return the message id');
      return sent.key.id;
    },
    download: (message) => downloadMediaMessage(message as unknown as WAMessage, 'buffer', {}, { logger: quiet, reuploadRequest: sock.updateMediaMessage }),
    pnForLid: (lid) => sock.signalRepository.lidMapping.getPNForLID(lid),
    end: () => { void sock.end(undefined); },
  };
};
