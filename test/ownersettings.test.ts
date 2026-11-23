import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OwnerSettings } from '../src/ownersettings.ts';
import { fixture } from './helpers.ts';

// How the AI makes new tasks (design 2026-11-21): unconfirmed until the owner's ✓, or real at once.
test('new AI tasks wait unconfirmed by default; the choice is kept in the data folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'settings-'));
  try {
    const settings = new OwnerSettings(join(dir, 'settings.json'));
    assert.equal(settings.triageNewTasks(), 'unconfirmed');
    settings.setTriageNewTasks('confirmed');
    assert.equal(new OwnerSettings(join(dir, 'settings.json')).triageNewTasks(), 'confirmed');
    assert.throws(() => settings.setTriageNewTasks('maybe' as never), /unconfirmed или confirmed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the System screen sets the mode; a bad value or no owner token is refused', async () => {
  const f = await fixture({ secrets: true });
  try {
    const set = (body: unknown, auth = true) => (auth ? f.request : (path: string, init: RequestInit) => fetch(f.base + path, init))('/api/settings/triage-new-tasks',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await set({ value: 'confirmed' })).status, 200);
    assert.equal(new OwnerSettings(join(f.directory, 'settings.json')).triageNewTasks(), 'confirmed');
    const bad = await set({ value: 'x' });
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as { error: string }).error, /unconfirmed или confirmed/);
    assert.equal((await set({ value: 'unconfirmed' }, false)).status, 401);
  } finally { await f.stop(); }
});

// Topic lifetimes (topics design 2026-11-23): the registry defaults until the owner sets them on the System screen.
test('topics fall back to the registry defaults; setTopics keeps integers 1–365', () => {
  const dir = mkdtempSync(join(tmpdir(), 'settings-'));
  try {
    const settings = new OwnerSettings(join(dir, 'settings.json'));
    const defaults = { topic_days: 14, archive_days: 3 };
    assert.deepEqual(settings.topics(defaults), defaults);
    settings.setTopics({ topic_days: 30, archive_days: 5 });
    assert.deepEqual(new OwnerSettings(join(dir, 'settings.json')).topics(defaults), { topic_days: 30, archive_days: 5 });
    for (const bad of [{ topic_days: 0, archive_days: 3 }, { topic_days: 14, archive_days: 400 }, { topic_days: 1.5, archive_days: 3 }]) {
      assert.throws(() => settings.setTopics(bad), /целые от 1 до 365/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('POST /api/settings/topics saves them and the client config serves them', async () => {
  const f = await fixture({ secrets: true });
  try {
    const set = (body: unknown) => f.request('/api/settings/topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await set({ topic_days: 21, archive_days: 2 })).status, 200);
    const config = (await (await fetch(`${f.base}/capture-config.json`)).json()) as { conversations: { topics: unknown } };
    assert.deepEqual(config.conversations.topics, { topic_days: 21, archive_days: 2 });
    const bad = await set({ topic_days: 0, archive_days: 2 });
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as { error: string }).error, /целые от 1 до 365/);
  } finally { await f.stop(); }
});
