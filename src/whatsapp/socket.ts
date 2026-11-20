import { mkdirSync } from 'node:fs';
import makeWASocket, { Browsers, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, useMultiFileAuthState, type WAMessage } from 'baileys';
import type { SocketFactory, WaMessage, WaUpdate } from './types.ts';

// The only file that imports Baileys (docs/plans/2026-11-20-whatsapp-baileys-design.md): one linked-device
// connection behind the narrow WaSocket interface. The session keys live in `authDir` (the data volume, never git).
// Stream never shows the owner as online (otherwise the phone stops showing WhatsApp notifications), does not get
// its own sends back as messages, and does not pull the history. The logger prints messages only, never objects:
// those may carry message content.

type Logger = NonNullable<Parameters<typeof makeWASocket>[0]['logger']>;
const say = (obj: unknown, msg?: string) => msg ?? (typeof obj === 'string' ? obj : '');
const quiet: Logger = {
  level: 'warn',
  child: () => quiet,
  trace() {}, debug() {}, info() {},
  warn(obj: unknown, msg?: string) { console.warn('WhatsApp:', say(obj, msg)); },
  error(obj: unknown, msg?: string) { console.error('WhatsApp:', say(obj, msg)); },
};

// Baileys' connection.update → ours: the state, the QR, whether the phone unlinked this device, why it closed.
export function updateOf(update: { connection?: string; qr?: string; lastDisconnect?: { error?: unknown } }): WaUpdate {
  const error = update.lastDisconnect?.error as { output?: { statusCode?: number }; message?: string } | undefined;
  const result: WaUpdate = { loggedOut: error?.output?.statusCode === DisconnectReason.loggedOut };
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
    auth: state, logger: quiet, browser: Browsers.ubuntu('Stream'), ...(latest?.version ? { version: latest.version } : {}),
    markOnlineOnConnect: false, emitOwnEvents: false, syncFullHistory: false, shouldSyncHistoryMessage: () => false,
    generateHighQualityLinkPreview: false,
  });
  sock.ev.on('creds.update', saveCreds);
  return {
    onUpdate: (fn) => { sock.ev.on('connection.update', (update) => fn(updateOf(update))); },
    onMessages: (fn) => { sock.ev.on('messages.upsert', (upsert) => { void fn({ messages: upsert.messages as unknown as WaMessage[], type: upsert.type }); }); },
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
