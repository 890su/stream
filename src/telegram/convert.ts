import { createHash } from 'node:crypto';
import type { Item } from './ingest.ts';

// A Bot API Message (business chat or group) → an item for ingest.ts. Files are fetched through `download`
// and stored before the item is written. Pure except for the two callbacks, so tests feed plain objects.

type Message = Record<string, any>;
export interface Files {
  limit: number;
  allowed: (mime: string) => boolean;
  download: (fileId: string) => Promise<Buffer>;
  store: (sha256: string, mime: string, bytes: Buffer) => void;
}

const iso = (unix: number) => new Date(unix * 1000).toISOString();
const fullName = (person: Message | undefined) => [person?.first_name, person?.last_name].filter(Boolean).join(' ') || person?.title || person?.username || '';

// Text for messages that have no text or file but still say something.
function serviceText(message: Message): string | undefined {
  if (message.sticker) return `[стикер${message.sticker.emoji ? ` ${message.sticker.emoji}` : ''}]`;
  if (message.venue) return `📍 ${message.venue.title} ${message.venue.address ?? ''}`.trim();
  if (message.location) return `📍 ${message.location.latitude.toFixed(5)}, ${message.location.longitude.toFixed(5)}`;
  if (message.contact) return `👤 ${[message.contact.first_name, message.contact.last_name].filter(Boolean).join(' ')} ${message.contact.phone_number ?? ''}`.trim();
  if (message.poll) return `📊 ${message.poll.question}`;
  return undefined;
}

// The one file of a message: { id, mime, size, kind, duration, name }.
function fileOf(message: Message) {
  if (message.photo?.length) {
    const largest = message.photo.at(-1);
    return { id: largest.file_id, mime: 'image/jpeg', size: largest.file_size, kind: 'photo', duration: undefined, name: undefined };
  }
  const voice = message.voice;
  if (voice) return { id: voice.file_id, mime: voice.mime_type ?? 'audio/ogg', size: voice.file_size, kind: 'voice', duration: voice.duration, name: undefined };
  for (const key of ['video_note', 'video', 'animation', 'audio', 'document']) {
    const file = message[key];
    if (!file) continue;
    const mime = file.mime_type ?? (key === 'video_note' ? 'video/mp4' : 'application/octet-stream');
    return { id: file.file_id, mime, size: file.file_size, kind: mime.startsWith('image/') ? 'photo' : 'file', duration: file.duration, name: file.file_name };
  }
  return undefined;
}

function forward(origin: Message | undefined) {
  if (!origin) return undefined;
  const result: Record<string, unknown> = { date: iso(origin.date) };
  if (origin.type === 'user') { result.from_id = String(origin.sender_user.id); result.from_name = fullName(origin.sender_user); }
  else if (origin.type === 'hidden_user') result.from_name = origin.sender_user_name;
  else if (origin.type === 'chat') { result.from_id = String(origin.sender_chat.id); result.from_name = origin.sender_chat.title; }
  else if (origin.type === 'channel') { result.from_id = String(origin.chat.id); result.from_name = origin.chat.title; }
  return result;
}

// `owners` — the account's own Telegram user ids: their messages are the owner's (author: me).
export async function toItem(message: Message, owners: Set<string>, files: Files, edited = false): Promise<Item | null> {
  const chat = message.chat ?? {};
  const group = chat.type === 'group' || chat.type === 'supergroup';
  const fromId = message.from ? String(message.from.id) : undefined;
  const out = Boolean(fromId && owners.has(fromId)) || Boolean(message.sender_business_bot);
  const text = message.text ?? message.caption ?? serviceText(message) ?? '';
  const item: Item = {
    chat_id: String(chat.id), chat_type: group ? 'group' : 'private', chat_title: group ? chat.title : fullName(chat),
    message_id: message.message_id, date: iso(message.date), out, text,
  };
  if (fromId) { item.from_id = fromId; item.from_name = fullName(message.from); }
  if (message.sender_business_bot) item.via_bot = true;
  if (edited) { item.edit_date = iso(message.edit_date ?? message.date); return item; }
  if (message.reply_to_message?.message_id) item.reply_to_message_id = message.reply_to_message.message_id;
  const origin = forward(message.forward_origin);
  if (origin) item.forward = origin;
  if (message.media_group_id && /^-?[0-9]{1,20}$/.test(message.media_group_id)) item.album_id = message.media_group_id;
  const file = fileOf(message);
  if (file) {
    item.kind = file.kind;
    const skip = !files.allowed(file.mime) ? 'unsupported' : file.size && file.size > files.limit ? 'too_large' : null;
    if (skip) item.media_skipped = { reason: skip, mime: file.mime, ...(file.size ? { size_bytes: file.size } : {}), ...(file.name ? { name: file.name } : {}) };
    else {
      try {
        const bytes = await files.download(file.id);
        const sha = createHash('sha256').update(bytes).digest('hex');
        files.store(sha, file.mime, bytes);
        item.media = [{ media_id: sha, mime: file.mime, size_bytes: bytes.length, ...(file.duration ? { duration_s: file.duration } : {}) }];
      } catch {
        item.media_skipped = { reason: 'failed', mime: file.mime };
      }
    }
  } else item.kind = 'text';
  if (!text && !file) return null; // joins, pins, title changes
  return item;
}
