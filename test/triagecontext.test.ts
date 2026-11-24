// The interlocutor's records in the triage context: theirs are never cut, others are capped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { interlocutorRecords, type Interlocutor } from '../src/tasks/triagecontext.ts';
import type { Task } from '../src/tasks/fold.ts';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const day = 86_400_000;
const at = (ms: number) => new Date(NOW - ms).toISOString();
const roles = (over: Partial<Task['roles']> = {}): Task['roles'] =>
  ({ author: null, responsible: 'me', executors: [], controller: null, watchers: [], counterparty: null, members: [], ...over });
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: id, status: 'todo', assignee: 'me', roles: roles(), filed: false, messages: [], items: [], owner_titled: false,
  created_by: 'me', created_at: at(100 * day), updated_at: at(day), ...over });
const who: Interlocutor = { key: 'tg:client', parties: new Set(['tel:+48111']), counterparties: new Set(['cp-1']) };
const opts = { now: NOW, reopenDays: 30, others: 10 };
const keys = (map: Record<string, string[]>) => (t: Task) => new Set(map[t.id] ?? []);
const ids = (list: Task[]) => list.map((t) => t.id);

test('an old open task of this client is in context although 50 others changed later', () => {
  const old = task('old', { updated_at: at(200 * day) });
  const others = Array.from({ length: 50 }, (_, i) => task(`o${i}`, { updated_at: at(i * 1000) }));
  const { open } = interlocutorRecords([old, ...others], who, keys({ old: ['tg:client'] }), opts);
  assert.ok(ids(open).includes('old'));
});

test('a task found by role party and one by counterparty are both in', () => {
  const byRole = task('role', { roles: roles({ executors: ['tel:+48111'] }) });
  const byCp = task('cp', { counterparty: 'cp-1' });
  const stranger = task('x', { updated_at: at(300 * day) });
  const many = Array.from({ length: 12 }, (_, i) => task(`n${i}`, { updated_at: at(i * 1000) }));
  const { open } = interlocutorRecords([byRole, byCp, stranger, ...many], who, keys({}), opts);
  assert.ok(ids(open).includes('role') && ids(open).includes('cp'));
  assert.ok(!ids(open).includes('x'));
});

test('others are capped at 10 and are only open ones', () => {
  const others = Array.from({ length: 25 }, (_, i) => task(`o${i}`, { updated_at: at(i * 1000) }));
  const done = task('done', { status: 'done', updated_at: at(10) });
  const { open, closed } = interlocutorRecords([...others, done], who, keys({}), opts);
  assert.equal(open.length, 10);
  assert.deepEqual(ids(open), others.slice(0, 10).map((t) => t.id));
  assert.equal(closed.length, 0);
});

test("closed ones only within reopen_days and only the interlocutor's", () => {
  const fresh = task('fresh', { status: 'done', updated_at: at(5 * day) });
  const stale = task('stale', { status: 'done', updated_at: at(40 * day) });
  const foreign = task('foreign', { status: 'done', updated_at: at(day) });
  const map = { fresh: ['tg:client'], stale: ['tg:client'] };
  const { closed } = interlocutorRecords([fresh, stale, foreign], who, keys(map), opts);
  assert.deepEqual(ids(closed), ['fresh']);
});
