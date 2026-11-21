import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectorSwitches, CONNECTORS } from '../src/switches.ts';
import { fixture, viberToken } from './helpers.ts';

// Switching connections off and on from the System screen (owner, 2026-11-21). Values are made up.
const TG = `123456789:${'x'.repeat(31)}oVrc`;

test('every connection is on until switched off; the choice is kept in the data folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'switches-'));
  try {
    const switches = new ConnectorSwitches(join(dir, 'switches.json'));
    assert.deepEqual(CONNECTORS, ['telegram_by', 'telegram_pl', 'whatsapp_pl', 'viber', 'android_phone', 'google_calendar', 'ai_triage']);
    assert.equal(switches.isOn('viber'), true);
    const changed: [string, boolean][] = [];
    switches.onChange((id, on) => changed.push([id, on]));
    switches.set('viber', false);
    assert.equal(new ConnectorSwitches(join(dir, 'switches.json')).isOn('viber'), false);
    assert.deepEqual(changed, [['viber', false]]);
    assert.throws(() => switches.set('nope', false), /Неизвестное подключение/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a switched-off channel from a device answers 503 (the device keeps its queue); the screen and the feed show it', async () => {
  const f = await fixture({ secrets: true });
  try {
    const viber = () => fetch(`${f.base}/api/viber/messages`, { method: 'POST', headers: { Authorization: `Bearer ${viberToken}`, 'Content-Type': 'application/json' }, body: '{}' });
    const toggle = (id: string, on: boolean) => f.request(`/api/connectors/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) });
    assert.equal((await toggle('viber', false)).status, 200);
    const off = await viber();
    assert.equal(off.status, 503);
    assert.match(((await off.json()) as { error: string }).error, /выключен/);
    const system = await (await f.request('/api/system')).json() as { sources: { source: string; on: boolean; state: string }[] };
    assert.deepEqual(system.sources.filter((item) => item.source === 'viber').map((item) => [item.on, item.state]), [[false, 'off']]);
    const { events } = await (await f.request('/api/events?limit=20')).json() as { events: { kind: string; payload: { text?: string } }[] };
    assert.ok(events.some((event) => event.kind === 'system' && /Viber: выключен на «Системе»/.test(event.payload.text ?? '')));
    assert.equal((await toggle('viber', true)).status, 200);
    assert.notEqual((await viber()).status, 503);
    assert.equal((await toggle('nope', false)).status, 404);
  } finally { await f.stop(); }
});

test('a bot switched off stops, its token kept; switched on it starts again', async () => {
  const f = await fixture({ secrets: true, telegram: { tokens: {}, apiBase: 'http://127.0.0.1:9' } });
  try {
    const bots = async () => Object.keys(((await (await f.request('/api/system')).json()) as { telegram: { bots: Record<string, unknown> } }).telegram.bots);
    await f.request('/api/secrets/STREAM_TG_BY_BOT_TOKEN', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: TG }) });
    assert.deepEqual(await bots(), ['by']);
    await f.request('/api/connectors/telegram_by', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: false }) });
    assert.deepEqual(await bots(), []);
    const secrets = await (await f.request('/api/secrets')).json() as { secrets: { name: string; set: boolean }[] };
    assert.ok(secrets.secrets.find((item) => item.name === 'STREAM_TG_BY_BOT_TOKEN')!.set, 'the token stays');
    await f.request('/api/connectors/telegram_by', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: true }) });
    assert.deepEqual(await bots(), ['by']);
  } finally { await f.stop(); }
});
