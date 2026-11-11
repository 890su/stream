import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { readdirSync, statSync, unlinkSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { event, temporaryStore } from './helpers.ts';
import { JournalStore } from '../src/store/store.ts';

test('journal is append-only at the database boundary', () => {
  const f = temporaryStore();
  try {
    const input = event();
    f.store.appendEvent(input);
    const db = new DatabaseSync(join(f.directory, 'stream.db'));
    try {
      assert.throws(() => db.prepare('UPDATE events SET author = ? WHERE id = ?').run('system', input.id), /append-only/);
      assert.throws(() => db.prepare('DELETE FROM events WHERE id = ?').run(input.id), /append-only/);
      assert.equal(db.prepare('SELECT count(*) AS count FROM events').get()?.count, 1);
    } finally { db.close(); }
  } finally { f.cleanup(); }
});

test('backup restores a consistent journal and all referenced immutable media', () => {
  const f = temporaryStore();
  const destination = `${f.directory}-backup`;
  try {
    const bytes = Buffer.from('photo');
    const id = createHash('sha256').update(bytes).digest('hex');
    f.store.putMedia(id, 'image/png', bytes);
    const saved = f.store.appendEvent(event({ kind: 'photo', payload: { media: [{ media_id: id, mime: 'image/png' }] } })).event;
    f.store.backupTo(destination);
    f.store.appendEvent(event());
    const restored = new JournalStore(destination);
    try {
      assert.deepEqual(restored.listEvents({ limit: 50 }).events, [saved]);
      assert.deepEqual(restored.readMedia(id)?.bytes, bytes);
      assert.throws(() => f.store.backupTo(destination));
    } finally { restored.close(); }
  } finally { f.cleanup(); rmSync(destination, { recursive: true, force: true }); }
});

test('canonical idempotency persists across restarts and key order', () => {
  const f = temporaryStore();
  try {
    const input = event({ payload: { data: { z: 1, a: { y: 2, x: 3 } } } });
    const first = f.store.appendEvent(input);
    assert.equal(first.created, true);
    const other = new JournalStore(f.directory);
    try {
      assert.equal(other.appendEvent({ ...input, payload: { data: { a: { x: 3, y: 2 }, z: 1 } } }).created, false);
      assert.throws(() => other.appendEvent({ ...input, payload: { text: 'changed' } }), /409/);
      assert.deepEqual(other.listEvents({ limit: 50 }).events, [first.event]);
    } finally { other.close(); }
  } finally { f.cleanup(); }
});

test('same-clock pagination is stable and server owns received_at', () => {
  const f = temporaryStore();
  const ids: string[] = [];
  try {
    for (let i = 0; i < 7; i++) {
      const result = f.store.appendEvent(event({ received_at: '2000-01-01T00:00:00Z' }));
      ids.unshift(result.event.id);
      assert.ok(result.event.received_at! > '2000');
    }
    let before: string | undefined;
    const actual: string[] = [];
    do {
      const page = f.store.listEvents({ before, limit: 2 });
      actual.push(...page.events.map((entry) => entry.id));
      before = page.next_before ?? undefined;
    } while (before);
    assert.deepEqual(actual, ids);
  } finally { f.cleanup(); }
});

test('media content addressing verifies hash and deduplicates files', () => {
  const f = temporaryStore();
  try {
    const bytes = Buffer.from('audio bytes');
    const id = createHash('sha256').update(bytes).digest('hex');
    assert.throws(() => f.store.putMedia('0'.repeat(64), 'audio/webm', bytes), /400/);
    assert.equal(f.store.putMedia(id, 'audio/webm', bytes).created, true);
    const modified = statSync(join(f.directory, 'media', id)).mtimeMs;
    assert.equal(f.store.putMedia(id, 'audio/webm', bytes).created, false);
    assert.equal(statSync(join(f.directory, 'media', id)).mtimeMs, modified);
    assert.equal(readdirSync(join(f.directory, 'media')).length, 1);
    assert.deepEqual(f.store.readMedia(id)?.bytes, bytes);
    unlinkSync(join(f.directory, 'media', id));
    assert.equal(f.store.putMedia(id, 'audio/webm', bytes).created, false);
    assert.deepEqual(f.store.readMedia(id)?.bytes, bytes);
    assert.throws(() => f.store.appendEvent(event({ payload: { media: [{ media_id: 'f'.repeat(64), mime: 'image/png' }] } })), /422/);
  } finally { f.cleanup(); }
});
