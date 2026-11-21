import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretStore, SECRETS } from '../src/secrets.ts';
import { fixture } from './helpers.ts';

// Keys entered on the System screen (owner, 2026-11-21: «как WhatsApp» — connected from the app). Values are made up.
// Not a real token: built from a repeated letter so no secret scanner takes it for one.
const TG = `123456789:${'x'.repeat(31)}oVrc`;

test('a key entered in the app wins over .env, is kept privately, never described with its value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'secrets-'));
  try {
    const store = new SecretStore(join(dir, 'secrets.json'), { STREAM_TG_BY_BOT_TOKEN: '111:env-token-value-long-enough-xx' });
    assert.equal(store.get('STREAM_TG_BY_BOT_TOKEN'), '111:env-token-value-long-enough-xx', '.env as before');
    const changed: string[] = [];
    store.onChange((name) => changed.push(name));
    store.set('STREAM_TG_BY_BOT_TOKEN', TG);
    assert.equal(store.get('STREAM_TG_BY_BOT_TOKEN'), TG);
    assert.deepEqual(changed, ['STREAM_TG_BY_BOT_TOKEN']);
    if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'secrets.json')).mode & 0o777, 0o600);
    const described = store.describe().find((item) => item.name === 'STREAM_TG_BY_BOT_TOKEN')!;
    assert.deepEqual([described.set, described.source, described.tail], [true, 'app', 'oVrc']);
    assert.ok(!JSON.stringify(store.describe()).includes(TG.slice(0, 20)), 'no value in the description');
    store.remove('STREAM_TG_BY_BOT_TOKEN');
    assert.equal(store.get('STREAM_TG_BY_BOT_TOKEN'), '111:env-token-value-long-enough-xx', 'back to .env');
    assert.equal(store.describe().find((item) => item.name === 'STREAM_TG_BY_BOT_TOKEN')!.source, 'env');
    assert.ok(!readFileSync(join(dir, 'secrets.json'), 'utf8').includes(TG));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('only known keys, each checked by its shape', () => {
  const dir = mkdtempSync(join(tmpdir(), 'secrets-'));
  try {
    const store = new SecretStore(join(dir, 'secrets.json'), {});
    assert.throws(() => store.set('PATH', 'x'), /Неизвестный ключ/);
    assert.throws(() => store.set('STREAM_TG_BY_BOT_TOKEN', 'not a token'), /токен бота/);
    assert.throws(() => store.set('STREAM_GOOGLE_CLIENT_ID', 'abc'), /Client ID/);
    store.set('STREAM_GOOGLE_CLIENT_ID', '1234-abc.apps.googleusercontent.com');
    assert.deepEqual(SECRETS.map((item) => item.name), ['STREAM_GOOGLE_CLIENT_ID', 'STREAM_GOOGLE_CLIENT_SECRET', 'STREAM_TG_BY_BOT_TOKEN', 'STREAM_TG_PL_BOT_TOKEN']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the routes: the owner sets and removes a key, never reads it back; Google turns on without a restart', async () => {
  const f = await fixture({ secrets: true });
  try {
    assert.equal((await fetch(`${f.base}/api/secrets`)).status, 401);
    const put = (name: string, value: string) => f.request(`/api/secrets/${name}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) });
    assert.equal((await put('STREAM_TG_BY_BOT_TOKEN', 'nope')).status, 400);
    assert.equal((await f.request('/api/google/connect')).status, 409, 'no Google client yet');
    assert.equal((await put('STREAM_GOOGLE_CLIENT_ID', '1234-abc.apps.googleusercontent.com')).status, 200);
    assert.equal((await put('STREAM_GOOGLE_CLIENT_SECRET', 'test-client-secret-value')).status, 200);
    const listed = await (await f.request('/api/secrets')).json() as { secrets: { name: string; set: boolean }[] };
    assert.ok(listed.secrets.find((item) => item.name === 'STREAM_GOOGLE_CLIENT_SECRET')!.set);
    assert.ok(!JSON.stringify(listed).includes('client-secret-value'), 'never read back');
    assert.equal((await f.request('/api/google/connect')).status, 200, 'Google is on at once');
    assert.equal((await f.request('/api/secrets/STREAM_GOOGLE_CLIENT_SECRET', { method: 'DELETE' })).status, 200);
    assert.equal((await f.request('/api/google/connect')).status, 409);
  } finally { await f.stop(); }
});

test('a bot token entered on the System screen starts that bot at once; removing it stops the bot', async () => {
  // The fake Bot API is a closed port: the bot exists and keeps trying, nothing reaches Telegram.
  const f = await fixture({ secrets: true, telegram: { tokens: {}, apiBase: 'http://127.0.0.1:9' } });
  try {
    const bots = async () => Object.keys(((await (await f.request('/api/system')).json()) as { telegram: { bots: Record<string, unknown> } }).telegram.bots);
    assert.deepEqual(await bots(), []);
    assert.equal((await f.request('/api/secrets/STREAM_TG_BY_BOT_TOKEN', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: TG }) })).status, 200);
    assert.deepEqual(await bots(), ['by']);
    assert.equal((await f.request('/api/secrets/STREAM_TG_BY_BOT_TOKEN', { method: 'DELETE' })).status, 200);
    assert.deepEqual(await bots(), []);
  } finally { await f.stop(); }
});
