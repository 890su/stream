import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import type { JournalStore } from '../store/store.ts';
import type { JournalEvent } from '../contracts/validate.ts';
import { captureConfig } from '../config.ts';
import { HttpError } from './errors.ts';
import { json, readBody } from './body.ts';
import type { LiveFeed } from './live.ts';

// Calls and SMS from the Android companion (CONCEPT.md §8.1, docs/plans/2026-11-17-p10-calls.md).
// Plain bodies in, ordinary journal events out. Ids come from the call or SMS itself, so a retry or a
// reinstall of the companion never writes the same call twice; PhoneIds.kt derives them the same way.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CALL_DIRECTIONS = ['in', 'out', 'missed', 'rejected', 'unknown'];
const SMS_DIRECTIONS = ['in', 'out'];

export function phoneEventId(key: string): string {
  const bytes = createHash('sha256').update(key, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type Body = Record<string, unknown>;

async function readJson(request: IncomingMessage): Promise<Body> {
  let value: unknown;
  try { value = JSON.parse((await readBody(request, captureConfig.max_event_bytes)).toString('utf8')); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Некорректный JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Ожидается объект JSON');
  return value as Body;
}

const text = (value: unknown, field: string): string => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new HttpError(400, `${field} должен быть строкой`);
  return value.trim();
};

// Milliseconds since the epoch, from an ISO date (calls, SMS) or a number (note written_at).
const time = (value: unknown, field: string): number => {
  const ms = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new HttpError(400, `${field} — некорректное время`);
  return ms;
};

const direction = (value: unknown, allowed: string[]): string => {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new HttpError(400, 'direction имеет недопустимое значение');
  return value;
};

// Optional strings are omitted when empty, so the stored event (and its hash) is the same on every retry.
const optional = (entries: Record<string, string>) => Object.fromEntries(Object.entries(entries).filter(([, value]) => value));

function phoneEvent(id: string, kind: string, ts: number, payload: JournalEvent['payload']): JournalEvent {
  return { id, schema_version: 1, source: 'android_phone', author: 'me', ts: new Date(ts).toISOString(), kind, payload };
}

function save(response: ServerResponse, store: JournalStore, live: LiveFeed, event: JournalEvent): void {
  const result = store.appendEvent(event);
  if (result.created) live.publish(result.event);
  json(response, result.created ? 201 : 200, { id: result.event.id });
}

function call(body: Body): JournalEvent {
  const number = text(body.number, 'number');
  const started = time(body.started_at, 'started_at');
  // A hidden number stays an empty string: the call still happened.
  const data: Record<string, unknown> = {
    direction: direction(body.direction, CALL_DIRECTIONS), number, started_at: new Date(started).toISOString(),
    ...optional({ name: text(body.name, 'name'), sim: text(body.sim, 'sim') }),
  };
  if (body.duration_s !== undefined && body.duration_s !== null) data.duration_s = body.duration_s; // the contract checks it
  return phoneEvent(phoneEventId(`call|${number}|${started}`), 'call', started, { data: { call: data } });
}

function sms(body: Body): JournalEvent {
  const way = direction(body.direction, SMS_DIRECTIONS);
  const number = text(body.number, 'number');
  const sent = time(body.sent_at, 'sent_at');
  if (typeof body.text !== 'string' || !body.text.trim()) throw new HttpError(400, 'У SMS нет текста');
  const data = { direction: way, number, ...optional({ name: text(body.name, 'name') }), sent_at: new Date(sent).toISOString(), ...optional({ sim: text(body.sim, 'sim') }) };
  return phoneEvent(phoneEventId(`sms|${way}|${number}|${sent}|${body.text}`), 'sms', sent, { text: body.text, data: { sms: data } });
}

function note(body: Body, callId: string, store: JournalStore): JournalEvent {
  const target = store.getEvent(callId);
  if (!target || target.kind !== 'call') throw new HttpError(404, 'Звонок не найден');
  if (typeof body.note_id !== 'string' || !UUID.test(body.note_id)) throw new HttpError(400, 'note_id должен быть UUID');
  if (typeof body.text !== 'string' || !body.text.trim()) throw new HttpError(400, 'Пустое описание');
  return phoneEvent(body.note_id.toLowerCase(), 'text', time(body.written_at, 'written_at'), { text: body.text.trim(), data: { continuation: { target: callId, on: true } } });
}

export async function phone(request: IncomingMessage, response: ServerResponse, path: string, store: JournalStore, live: LiveFeed): Promise<void> {
  if (path === 'ping') {
    if (request.method !== 'GET') throw new HttpError(405, 'Метод не поддерживается');
    response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
    return;
  }
  if (request.method !== 'POST') throw new HttpError(405, 'Метод не поддерживается');
  if (path === 'calls') return save(response, store, live, call(await readJson(request)));
  if (path === 'sms') return save(response, store, live, sms(await readJson(request)));
  const noteMatch = /^calls\/([^/]+)\/note$/.exec(path);
  if (noteMatch) return save(response, store, live, note(await readJson(request), noteMatch[1]!.toLowerCase(), store));
  throw new HttpError(404, 'Маршрут не найден');
}
