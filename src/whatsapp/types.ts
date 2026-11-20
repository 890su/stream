import type { MediaRef } from '../contracts/validate.ts';

// The narrow shapes the WhatsApp code works with (docs/plans/2026-11-20-whatsapp-baileys-design.md). Only
// src/whatsapp/socket.ts imports Baileys; everything else — and every test — sees these instead.

export interface WaKey { remoteJid?: string | null; remoteJidAlt?: string | null; fromMe?: boolean | null; id?: string | null }

// A WhatsApp message as Baileys hands it over: the key, the content (a protobuf object), the time, the sender's name.
export interface WaMessage {
  key: WaKey;
  message?: Record<string, any> | null;
  messageTimestamp?: number | { toNumber(): number } | null;
  pushName?: string | null;
}

// `loggedOut` — the phone unlinked this device; `restart` — WhatsApp asks for a new connection (right after linking).
export type WaUpdate = { connection?: 'open' | 'close' | 'connecting'; qr?: string; loggedOut?: boolean; restart?: boolean; reason?: string };

// One linked-device connection.
export interface WaSocket {
  onUpdate(fn: (update: WaUpdate) => void): void;
  onMessages(fn: (upsert: { messages: WaMessage[]; type: string }) => Promise<void>): void;
  sendText(jid: string, text: string): Promise<string>;   // the id of the message sent
  download(message: WaMessage): Promise<Buffer>;
  pnForLid(lid: string): Promise<string | null>;
  end(): void;
}

export type SocketFactory = (authDir: string) => Promise<WaSocket>;

// Where a message's file goes: the limit, the accepted types, how to fetch it and where to keep it.
export interface WaFiles {
  limit: number;
  allowed(mime: string): boolean;
  download(message: WaMessage): Promise<Buffer>;
  store(sha256: string, mime: string, bytes: Buffer): void;
}

// A message ready to become a journal event (src/whatsapp/ingest.ts).
export interface WaItem {
  id: string; jid: string; phone?: string; chat: string; out: boolean; date: string;
  kind: 'text' | 'voice' | 'photo' | 'file'; text: string; media?: MediaRef[];
}
