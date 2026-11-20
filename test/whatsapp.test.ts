import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, temporaryStore } from './helpers.ts';
import { fakeWa, waitFor } from './fakewa.ts';
import { WhatsAppClient } from '../src/whatsapp/client.ts';
import { LiveFeed } from '../src/server/live.ts';
import type { WaMessage } from '../src/whatsapp/types.ts';

const now = () => Math.floor(Date.now() / 1000);
const text = (id: string, extra: Partial<WaMessage> = {}): WaMessage => ({
  key: { remoteJid: '48500000001@s.whatsapp.net', id, fromMe: false }, message: { conversation: 'Cześć' }, messageTimestamp: now(), pushName: 'Anna', ...extra,
});
type F = Awaited<ReturnType<typeof fixture>>;
const waEvents = (f: F) => f.store.listEvents({ limit: 200 }).events.filter((item) => item.source === 'whatsapp');
const status = (f: F) => f.store.status.get('whatsapp_pl');

async function linked() {
  const wa = fakeWa();
  const f = await fixture({ whatsapp: { accounts: ['pl'], factory: wa.factory } });
  await waitFor(() => wa.sockets.length === 1);
  return { wa, f };
}

test('an incoming message is written once, by phone', async () => {
  const { wa, f } = await linked();
  try {
    wa.last().emitUpdate({ connection: 'open' });
    await wa.last().emitMessages([text('A1')], 'notify');
    await wa.last().emitMessages([text('A1')], 'append');
    const events = waEvents(f);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.author, 'contact:whatsapp:+48500000001');
    assert.equal(events[0]!.payload.text, 'Cześć');
    const data = events[0]!.payload.data?.whatsapp as Record<string, unknown>;
    assert.equal(data.account, 'pl');
    assert.equal(data.chat, 'Anna');
    assert.equal(data.phone, '+48500000001');
    assert.equal(status(f)?.state, 'ok');
  } finally { await f.stop(); }
});

test('my message from the phone is mine, in the same chat', async () => {
  const { wa, f } = await linked();
  try {
    wa.last().emitUpdate({ connection: 'open' });
    await wa.last().emitMessages([text('M1', { key: { remoteJid: '48500000001@s.whatsapp.net', id: 'M1', fromMe: true }, message: { conversation: 'Jestem w drodze' } })]);
    const [event] = waEvents(f);
    assert.equal(event?.author, 'me');
    assert.equal((event?.payload.data?.whatsapp as Record<string, unknown>).phone, '+48500000001');
  } finally { await f.stop(); }
});

test('an old message is not written', async () => {
  const { wa, f } = await linked();
  try {
    wa.last().emitUpdate({ connection: 'open' });
    await wa.last().emitMessages([text('O1', { messageTimestamp: now() - 49 * 3600 })]);
    assert.equal(waEvents(f).length, 0);
  } finally { await f.stop(); }
});

test('the QR is shown until the device is linked', async () => {
  const { wa, f } = await linked();
  try {
    wa.last().emitUpdate({ qr: '2@abc' });
    assert.equal(status(f)?.state, 'login_required');
    assert.equal(status(f)?.info?.qr, true);
    const image = await f.request('/api/whatsapp/pl/qr');
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual([...new Uint8Array(await image.arrayBuffer()).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    const notes = f.store.listEvents({ limit: 50 }).events.filter((item) => item.kind === 'system').map((item) => item.payload.text);
    assert.ok(notes.some((note) => /^WhatsApp PL: нужен вход/.test(note ?? '')), JSON.stringify(notes));
    wa.last().emitUpdate({ connection: 'open' });
    assert.equal(status(f)?.state, 'ok');
    assert.equal((await f.request('/api/whatsapp/pl/qr')).status, 404);
  } finally { await f.stop(); }
});

test('unlinked on the phone: keys removed, a new QR', async () => {
  const { wa, f } = await linked();
  try {
    mkdirSync(wa.dirs[0]!, { recursive: true });
    writeFileSync(join(wa.dirs[0]!, 'creds.json'), '{}');
    wa.last().emitUpdate({ connection: 'open' });
    wa.last().emitUpdate({ connection: 'close', loggedOut: true, reason: 'logged out' });
    await waitFor(() => wa.sockets.length === 2);
    assert.equal(existsSync(wa.dirs[0]!), false);
    assert.equal(status(f)?.state, 'login_required');
    assert.match(status(f)?.detail ?? '', /устройство отвязано/);
  } finally { await f.stop(); }
});

test('a lost connection is an error and reconnects', async () => {
  const { wa, f } = await linked();
  try {
    wa.last().emitUpdate({ connection: 'open' });
    wa.last().emitUpdate({ connection: 'close', loggedOut: false, reason: 'stream errored' });
    assert.equal(status(f)?.state, 'error');
    assert.match(status(f)?.detail ?? '', /нет связи с WhatsApp \(stream errored\)/);
    await waitFor(() => wa.sockets.length === 2);
    assert.equal(wa.sockets[0]!.ended, true);
  } finally { await f.stop(); }
});

test('a restart after linking reconnects quietly', async () => {
  const { wa, f } = await linked();
  try {
    wa.last().emitUpdate({ connection: 'open' });
    wa.last().emitUpdate({ connection: 'close', loggedOut: false, restart: true, reason: 'restart required' });
    await waitFor(() => wa.sockets.length === 2);
    assert.equal(status(f)?.state, 'ok');
    assert.equal(f.store.listEvents({ limit: 50 }).events.filter((item) => item.kind === 'system' && /ошибка/.test(item.payload.text ?? '')).length, 0);
  } finally { await f.stop(); }
});

test('a broken message does not stop the server', async () => {
  const { wa, f } = await linked();
  try {
    wa.last().emitUpdate({ connection: 'open' });
    const exploding = { get key(): never { throw new Error('boom'); } } as unknown as WaMessage;
    await wa.last().emitMessages([
      exploding,
      { key: {}, message: null },
      { key: { remoteJid: '48500000001@s.whatsapp.net', id: 'B1' }, message: { imageMessage: {} }, messageTimestamp: now() },
      text('C1'),
    ]);
    assert.deepEqual(waEvents(f).map((item) => item.payload.text).sort(), ['Cześć', '[файл «image/jpeg» не загружен: ошибка загрузки]']);
    assert.equal((await fetch(f.base + '/healthz')).status, 200);
  } finally { await f.stop(); }
});

test('the QR route needs the owner token', async () => {
  const { wa, f } = await linked();
  try {
    wa.last().emitUpdate({ qr: '2@abc' });
    assert.equal((await fetch(f.base + '/api/whatsapp/pl/qr')).status, 401);
  } finally { await f.stop(); }
});

test('without the option no WhatsApp client runs', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/api/whatsapp/pl/qr')).status, 404);
  } finally { await f.stop(); }
});

test('an idle connection keeps its pulse', async () => {
  const storage = temporaryStore();
  const wa = fakeWa();
  const client = new WhatsAppClient({ account: 'pl', store: storage.store, live: new LiveFeed(), authDir: join(storage.directory, 'wa'), factory: wa.factory, retryMs: 10, pulseMs: 20 });
  try {
    await client.start();
    wa.last().emitUpdate({ connection: 'open' });
    const first = storage.store.status.get('whatsapp_pl')?.pulse_at;
    await waitFor(() => storage.store.status.get('whatsapp_pl')?.pulse_at !== first);
    assert.equal(storage.store.status.get('whatsapp_pl')?.state, 'ok');
  } finally { client.stop(); storage.cleanup(); }
});
