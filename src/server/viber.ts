import type { IncomingMessage, ServerResponse } from 'node:http';
import { nameId } from '../ids.ts';
import type { JournalStore } from '../store/store.ts';
import type { JournalEvent } from '../contracts/validate.ts';
import type { SourceState } from '../store/status.ts';
import { VIBER_CONNECTOR } from '../contracts/viber.ts';
import { captureConfig } from '../config.ts';
import { HttpError } from './errors.ts';
import { json, readBody } from './body.ts';
import { actionChanged, stateChanged } from './system.ts';
import type { LiveFeed } from './live.ts';

// The Viber bridge on the agent desktop (deploy/desktop/bin/viber-bridge, deploy/DESKTOP.md) talks to Stream here:
// incoming messages become journal events, the channel's state is a pulse (its changes are `system` events), and
// replies written in the feed are handed out one by one as actions and reported back.
// The bridge holds STREAM_VIBER_TOKEN, which opens only /api/viber/*.

type Body = Record<string, unknown>;
const PHONE = /^\+[0-9]{6,15}$/;
// The desktop's states (viber-health) → the System screen's: a QR screen needs the owner, the rest is an error.
const STATES: Record<string, SourceState> = { ok: 'ok', logged_out: 'login_required' };

async function readJson(request: IncomingMessage): Promise<Body> {
  let value: unknown;
  try { value = JSON.parse((await readBody(request, captureConfig.max_event_bytes)).toString('utf8')); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Некорректный JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Ожидается объект JSON');
  return value as Body;
}
const str = (value: unknown) => typeof value === 'string' ? value.trim() : '';

// One incoming message. `key` is the bridge's own id of the notification, so a retry writes nothing new.
// The author is the phone when Viber shows it (the same person as their calls and SMS), else the chat's name.
export function viberMessage(body: Body): JournalEvent {
  const key = str(body.key); const chat = str(body.chat).slice(0, 200); const phone = str(body.phone);
  const text = typeof body.text === 'string' ? body.text : '';
  const ms = Date.parse(str(body.received_at));
  if (!key) throw new HttpError(400, 'Нет key');
  if (!chat) throw new HttpError(400, 'Нет chat');
  if (phone && !PHONE.test(phone)) throw new HttpError(400, 'phone — номер вида +375…');
  if (!text.trim()) throw new HttpError(400, 'Пустое сообщение');
  if (!Number.isFinite(ms)) throw new HttpError(400, 'received_at — некорректное время');
  const at = new Date(ms).toISOString();
  const viber = { chat, ...(phone ? { phone } : {}), ...(body.group === true ? { group: true } : {}), received_at: at };
  return {
    id: nameId(`viber|${key}`), schema_version: 1, source: 'viber', author: `contact:viber:${phone || chat}`, ts: at, kind: 'text',
    payload: { text, data: { viber } },
  };
}

export async function viber(request: IncomingMessage, response: ServerResponse, path: string, store: JournalStore, live: LiveFeed): Promise<void> {
  if (request.method !== 'POST') throw new HttpError(405, 'Метод не поддерживается');
  if (path === 'messages') {
    const result = store.appendEvent(viberMessage(await readJson(request)));
    if (result.created) { live.publish(result.event); store.status.seen(VIBER_CONNECTOR, result.event.received_at!); }
    json(response, result.created ? 201 : 200, { id: result.event.id });
    return;
  }
  if (path === 'pulse') {
    const body = await readJson(request);
    const raw = str(body.state) || 'error';
    const state = STATES[raw] ?? 'error';
    const detail = state === 'ok' ? null : (str(body.detail) || raw).slice(0, 300);
    const previous = store.status.pulse(VIBER_CONNECTOR, state, detail, { state: raw }, new Date().toISOString());
    stateChanged(store, live, VIBER_CONNECTOR, state, previous, detail);
    response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
    return;
  }
  // The bridge (re)started: a send it had taken may or may not have gone out — it is not sent again.
  if (path === 'hello') {
    for (const action of store.actions.failRunning(VIBER_CONNECTOR, 'Мост Viber перезапустился во время отправки — проверьте в Viber, ушло ли сообщение')) actionChanged(store, live, action);
    response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
    return;
  }
  if (path === 'actions/next') {
    const action = store.actions.take(VIBER_CONNECTOR);
    if (!action) { response.writeHead(204, { 'Cache-Control': 'no-store' }).end(); return; }
    actionChanged(store, live, action);
    json(response, 200, { id: action.id, phone: action.params.chat_id, text: action.params.text });
    return;
  }
  const done = /^actions\/([0-9a-f-]{36})$/.exec(path);
  if (done) {
    const body = await readJson(request);
    if (body.status !== 'done' && body.status !== 'failed') throw new HttpError(400, 'status — done или failed');
    const error = body.status === 'failed' ? (str(body.error) || 'не отправлено').slice(0, 300) : null;
    const { action, changed } = store.actions.finish(done[1]!, VIBER_CONNECTOR, body.status, null, error);
    if (changed) actionChanged(store, live, action);
    response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
    return;
  }
  throw new HttpError(404, 'Маршрут не найден');
}
