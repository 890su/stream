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
