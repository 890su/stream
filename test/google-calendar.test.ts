import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeEvent, CalendarPoller } from '../src/google/calendar.ts';
import { NeedsLogin } from '../src/google/oauth.ts';

// Reading the owner's calendars (docs/plans/2026-11-20-google-calendar-design.md, stage 1). Names are made up.
const config = { poll_s: 60, window_days: 14, reconnect_max_s: 120, hidden_by_default: ['#holiday@group.v.calendar.google.com'], stream_calendar: 'Stream' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('an event: all-day keeps its days, a timed one its instant, a cancelled one is dropped', () => {
  const allDay = normalizeEvent({ id: 'e1', summary: 'Отпуск', start: { date: '2026-11-25' }, end: { date: '2026-11-27' }, htmlLink: 'https://g/e1' }, 'cal');
  assert.deepEqual(allDay, { id: 'e1', calendar: 'cal', title: 'Отпуск', start: '2026-11-25', end: '2026-11-27', allDay: true, link: 'https://g/e1' });
  const timed = normalizeEvent({ id: 'e2', start: { dateTime: '2026-11-25T19:00:00+03:00' }, end: { dateTime: '2026-11-25T20:00:00+03:00' } }, 'cal')!;
  assert.deepEqual([timed.title, timed.start, timed.end, timed.allDay], ['(без названия)', '2026-11-25T16:00:00.000Z', '2026-11-25T17:00:00.000Z', false]);
  assert.equal(normalizeEvent({ id: 'e3', status: 'cancelled', start: { date: '2026-11-25' } }, 'cal'), null);
});

// A fake Google: two accounts, a calendar list each, events per calendar.
function fakeGoogle() {
  const state = { failEvents: false, calls: [] as string[] };
  const lists: Record<string, unknown[]> = {
    'a1': [{ id: 'anna@example.com', summary: 'Анна', primary: true }, { id: 'en.by#holiday@group.v.calendar.google.com', summary: 'Праздники' }, { id: 'family@group', summary: 'Семья' }],
    'b1': [{ id: 'boris@example.com', summary: 'Борис', primary: true }, { id: 'family@group', summary: 'Семья' }],
  };
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const text = String(url);
    state.calls.push(text);
    const token = String((init?.headers as Record<string, string>)?.Authorization ?? '').replace('Bearer ', '');
    if (text.includes('/users/me/calendarList')) return reply(200, { items: lists[token] });
    if (state.failEvents) return reply(500, { error: { message: 'backend' } });
    const calendar = decodeURIComponent(text.split('/calendars/')[1]!.split('/events')[0]!);
    return reply(200, { items: [{ id: `${calendar}-1`, summary: `событие ${calendar}`, start: { dateTime: '2026-11-21T09:00:00Z' }, end: { dateTime: '2026-11-21T10:00:00Z' } }] });
  };
  return { state, fetch };
}

test('a poll reads every visible calendar once (a shared one once), holidays hidden by default; an outage keeps the last events', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gcal-'));
  try {
    const google = fakeGoogle();
    const health: string[] = [];
    const accounts = { list: () => [{ email: 'anna@example.com' }, { email: 'boris@example.com' }], accessToken: async (email: string) => (email.startsWith('anna') ? 'a1' : 'b1') };
    const poller = new CalendarPoller({ accounts, fetch: google.fetch, config, dir, now: () => new Date('2026-11-21T08:00:00Z'), onHealth: (state) => health.push(state) });
    await poller.poll();
    const titles = poller.events('2026-11-20T00:00:00Z', '2026-11-23T00:00:00Z').map((event) => event.calendar).sort();
    assert.deepEqual(titles, ['anna@example.com', 'boris@example.com', 'family@group']);
    assert.equal(poller.calendars().find((item) => item.id.includes('holiday'))!.hidden, true);
    assert.equal(google.state.calls.filter((call) => call.includes('family%40group')).length, 1, 'a shared calendar is read once');
    assert.equal(health.at(-1), 'ok');
    google.state.failEvents = true;
    await poller.poll();
    assert.equal(poller.events('2026-11-20T00:00:00Z', '2026-11-23T00:00:00Z').length, 3, 'the last good events stay');
    assert.equal(health.at(-1), 'error');
    poller.setHidden('family@group', true);
    assert.deepEqual(poller.events('2026-11-20T00:00:00Z', '2026-11-23T00:00:00Z').map((event) => event.calendar).sort(), ['anna@example.com', 'boris@example.com']);
    const again = new CalendarPoller({ accounts, fetch: google.fetch, config, dir, now: () => new Date('2026-11-21T08:00:00Z'), onHealth: () => {} });
    assert.equal(again.isHidden('family@group'), true, 'the choice is kept in the data folder');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an account that must sign in again: «нужен вход», the other keeps its events; no accounts — «нужен вход» too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gcal-'));
  try {
    const google = fakeGoogle();
    const health: [string, string | null][] = [];
    const accounts = { list: () => [{ email: 'anna@example.com' }, { email: 'boris@example.com' }],
      accessToken: async (email: string) => { if (email.startsWith('anna')) throw new NeedsLogin(email); return 'b1'; } };
    const poller = new CalendarPoller({ accounts, fetch: google.fetch, config, dir, now: () => new Date('2026-11-21T08:00:00Z'), onHealth: (state, detail) => health.push([state, detail]) });
    await poller.poll();
    assert.deepEqual(poller.accountStates(), [{ email: 'anna@example.com', state: 'login_required' }, { email: 'boris@example.com', state: 'ok' }]);
    assert.equal(health.at(-1)![0], 'login_required');
    assert.match(health.at(-1)![1]!, /anna@example\.com/);
    assert.equal(poller.events('2026-11-20T00:00:00Z', '2026-11-23T00:00:00Z').length, 2);
    const none = new CalendarPoller({ accounts: { list: () => [], accessToken: async () => '' }, fetch: google.fetch, config, dir, onHealth: (state, detail) => health.push([state, detail]) });
    await none.poll();
    assert.deepEqual(health.at(-1), ['login_required', 'подключите Google на экране «Система»']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
