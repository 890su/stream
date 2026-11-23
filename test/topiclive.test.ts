import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { liveTopics, defaultTopic, pickable } from '../web/topiclive.js';

// Which topics are live in a conversation (topics design 2026-11-23). Titles are made up.
const now = new Date('2026-11-23T12:00:00Z');
const days = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const topics = { topic_days: 14, archive_days: 3 };
const record = (id: string, kind: 'topic' | 'task', last: string, extra: Record<string, unknown> = {}) =>
  ({ id, title: id, kind, offer: false, status: 'todo', filed: false, messages: [`${id}-m`], history: [], last, ...extra });
const lastAt = (task: { last: string }) => task.last;
const view = (id: string, ts: string, taskIds: string[]) => ({ id, event: { ts }, taskIds });
const conversation = (tasks: unknown[], { waiting = false, handled = days(0) } = {}) =>
  ({ key: 'tg:by:1', tasks, views: [view('v1', handled, [])], last: handled, queue: { waiting } });

test('a topic silent for 15 days is not live; 10 days is', () => {
  const live = liveTopics(conversation([record('старая', 'topic', days(15)), record('свежая', 'topic', days(10))], { waiting: true }), { now, topics, lastAt });
  assert.deepEqual(live.map((task: { id: string }) => task.id), ['свежая']);
});

test('a topic of a conversation handled 4 days ago is not live; 2 days ago it is', () => {
  const topic = record('принтер', 'topic', days(4));
  assert.deepEqual(liveTopics(conversation([topic], { handled: days(4) }), { now, topics, lastAt }), []);
  assert.equal(liveTopics(conversation([topic], { handled: days(2) }), { now, topics, lastAt }).length, 1);
});

test('a waiting conversation keeps a 10-day topic live', () => {
  assert.equal(liveTopics(conversation([record('счёт', 'topic', days(10))], { waiting: true, handled: days(10) }), { now, topics, lastAt }).length, 1);
});

test('an open task is live whatever its age; closed and filed records are not', () => {
  const live = liveTopics(conversation([record('выезд', 'task', days(60)), record('готово', 'task', days(1), { status: 'done' }),
    record('заметка', 'task', days(1), { filed: true }), record('отменена', 'topic', days(1), { status: 'cancelled' })], { handled: days(30) }), { now, topics, lastAt });
  assert.deepEqual(live.map((task: { id: string }) => task.id), ['выезд']);
});

test('tasks first, then topics; each newest first', () => {
  const live = liveTopics(conversation([record('т1', 'topic', days(2)), record('з1', 'task', days(5)), record('т2', 'topic', days(1)), record('з2', 'task', days(1))], { waiting: true }), { now, topics, lastAt });
  assert.deepEqual(live.map((task: { id: string }) => task.id), ['з2', 'з1', 'т2', 'т1']);
});

test('the default is the live record of the newest message; none — null', () => {
  const a = record('a', 'topic', days(1));
  const b = record('b', 'topic', days(1));
  const talk = { ...conversation([a, b], { waiting: true }), views: [view('v1', days(2), ['a']), view('v2', days(1), ['b']), view('v3', days(0), [])] };
  assert.equal(defaultTopic(talk, [a, b]), 'b', 'the newest message with a live record');
  assert.equal(defaultTopic({ ...talk, views: [view('v3', days(0), ['gone'])] }, [a, b]), null);
});

test('pickable: live records here, live topics of other conversations, open tasks', () => {
  const here = conversation([record('здесь', 'topic', days(1))], { waiting: true });
  const other = { ...conversation([record('там', 'topic', days(1)), record('дело', 'task', days(40))], { waiting: true }), key: 'tg:by:2' };
  const groups = pickable([here, other], here.key, { now, topics, lastAt });
  assert.deepEqual(groups.here.map((task: { id: string }) => task.id), ['здесь']);
  assert.deepEqual(groups.other.map((task: { id: string }) => task.id), ['там']);
  assert.deepEqual(groups.tasks.map((task: { id: string }) => task.id), ['дело']);
});
