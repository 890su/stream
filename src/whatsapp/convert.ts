import { createHash } from 'node:crypto';
import type { WaFiles, WaItem, WaMessage } from './types.ts';

// A WhatsApp message (Baileys) → an item for ingest.ts. Only personal chats: a phone address `<n>@s.whatsapp.net`
// or an anonymous LID `<id>@lid` (WhatsApp, 2025); the phone comes from either address of the key or the LID cache.
// Files are fetched and stored through `files` before the item is returned. Pure except for the callbacks, so
// tests feed plain objects (decision 2026-11-20, docs/plans/2026-11-20-whatsapp-baileys-design.md).

const PERSONAL = /^[0-9]+@(s\.whatsapp\.net|lid)$/;
const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage'];
const SKIPPED = ['protocolMessage', 'reactionMessage', 'stickerMessage', 'pollUpdateMessage', 'editedMessage'];
const SERVICE = new Set(['messageContextInfo', 'senderKeyDistributionMessage']);   // parts that are not content
// A message of a kind Stream does not read: a note instead of silence.
const UNKNOWN = '[сообщение WhatsApp, которое Stream не показывает — откройте в WhatsApp]';

export const bareJid = (jid: string): string => jid.replace(/:\d+@/, '@');

export function phoneOfJid(jid: string): string | undefined {
  const match = /^([0-9]{6,15})@s\.whatsapp\.net$/.exec(jid);
  return match ? `+${match[1]}` : undefined;
}

// A protobuf number may come as a Long.
const numberOf = (value: unknown): number => typeof value === 'number' ? value
  : value && typeof (value as { toNumber?: unknown }).toNumber === 'function' ? (value as { toNumber(): number }).toNumber() : Number(value);

const baseMime = (mime: string) => mime.split(';')[0]!.trim().toLowerCase();

function unwrap(content: Record<string, any>): Record<string, any> {
  let current = content;
  for (let depth = 0; depth < 5; depth++) {
    const wrapper = WRAPPERS.find((key) => current[key]?.message);
    if (!wrapper) break;
    current = current[wrapper].message;
  }
  return current;
}

// Text in words: typed text, a caption, a business message's body, a place, contacts, a poll.
function textOf(c: Record<string, any>): string {
  const text = c.conversation ?? c.extendedTextMessage?.text ?? c.imageMessage?.caption ?? c.videoMessage?.caption ?? c.documentMessage?.caption
    ?? c.ptvMessage?.caption ?? c.buttonsMessage?.contentText ?? c.templateMessage?.hydratedTemplate?.hydratedContentText ?? c.interactiveMessage?.body?.text;
  if (text) return String(text);
  const place = c.locationMessage ?? c.liveLocationMessage;
  if (place) return `📍 ${numberOf(place.degreesLatitude).toFixed(5)}, ${numberOf(place.degreesLongitude).toFixed(5)}`;
  if (c.contactMessage?.displayName) return `👤 ${c.contactMessage.displayName}`;
  const contacts = (c.contactsArrayMessage?.contacts ?? []).map((contact: { displayName?: string }) => contact.displayName).filter(Boolean);
  if (contacts.length) return `👤 ${contacts.join(', ')}`;
  const poll = c.pollCreationMessage ?? c.pollCreationMessageV2 ?? c.pollCreationMessageV3;
  if (poll?.name) return `📊 ${poll.name}`;
  return '';
}

// The one file of a message: its kind, type, size, length and name.
function fileOf(c: Record<string, any>) {
  const of = (node: Record<string, any>, kind: WaItem['kind'], fallback: string) => {
    const mime = baseMime(node.mimetype || fallback);
    const size = node.fileLength === undefined || node.fileLength === null ? undefined : numberOf(node.fileLength);
    const duration = node.seconds ? numberOf(node.seconds) : undefined;
    return { kind, mime, size, duration, name: node.fileName as string | undefined };
  };
  if (c.imageMessage) return of(c.imageMessage, 'photo', 'image/jpeg');
  if (c.audioMessage) return of(c.audioMessage, c.audioMessage.ptt ? 'voice' : 'file', 'audio/ogg');
  if (c.videoMessage) return of(c.videoMessage, 'file', 'video/mp4');
  if (c.ptvMessage) return of(c.ptvMessage, 'file', 'video/mp4');               // a round video note
  if (c.documentMessage) {
    const file = of(c.documentMessage, 'file', 'application/octet-stream');
    return { ...file, kind: file.mime.startsWith('image/') ? 'photo' as const : 'file' as const };
  }
  return undefined;
}

async function phoneOf(remote: string, alt: string | null | undefined, pnForLid: (lid: string) => Promise<string | null>) {
  const direct = phoneOfJid(remote) ?? (alt ? phoneOfJid(bareJid(alt)) : undefined);
  if (direct || !remote.endsWith('@lid')) return direct;
  const known = await pnForLid(remote);
  return known ? phoneOfJid(bareJid(known)) : undefined;
}

export async function toItem(message: WaMessage, files: WaFiles, pnForLid: (lid: string) => Promise<string | null>): Promise<WaItem | null> {
  const { key } = message;
  if (!key.remoteJid || !key.id || !message.message) return null;
  const jid = bareJid(key.remoteJid);
  if (!PERSONAL.test(jid)) return null;                       // groups, status, channels
  const content = unwrap(message.message);
  if (SKIPPED.some((name) => content[name])) return null;     // reactions, stickers, edits, service messages
  let text = textOf(content);
  const file = fileOf(content);
  if (!text && !file) {
    if (!Object.keys(content).some((part) => !SERVICE.has(part) && content[part] != null)) return null;
    text = UNKNOWN;
  }

  const phone = await phoneOf(jid, key.remoteJidAlt, pnForLid);
  const out = Boolean(key.fromMe);
  const user = jid.split('@')[0]!;
  const chat = (out ? phone ?? user : message.pushName?.trim() || phone || user).slice(0, 200);
  const seconds = numberOf(message.messageTimestamp);
  const date = (Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date()).toISOString();

  const item: WaItem = { id: key.id, jid, ...(phone ? { phone } : {}), chat, out, date, kind: 'text', text };
  if (file) {
    const megabytes = Math.round(files.limit / 1_048_576);
    // A file is held in memory while it downloads: without a known size it is not fetched at all.
    let reason: string | null = !files.allowed(file.mime) ? 'такой тип не принимается'
      : file.size === undefined || !Number.isFinite(file.size) ? 'размер неизвестен'
      : file.size > files.limit ? `больше ${megabytes} МБ` : null;
    if (!reason) {
      try {
        const bytes = await files.download(message);
        if (bytes.length > files.limit) reason = `больше ${megabytes} МБ`;
        else {
          const sha = createHash('sha256').update(bytes).digest('hex');
          files.store(sha, file.mime, bytes);
          item.kind = file.kind;
          item.media = [{ media_id: sha, mime: file.mime, size_bytes: bytes.length, ...(file.duration ? { duration_s: file.duration } : {}) }];
        }
      } catch {
        reason = 'ошибка загрузки';
      }
    }
    if (reason) text = [text, `[файл «${file.name || file.mime}» не загружен: ${reason}]`].filter(Boolean).join('\n');
  }
  item.text = text;
  return item;
}
