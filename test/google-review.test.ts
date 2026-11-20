import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CalendarPoller } from '../src/google/calendar.ts';
import { exchangeCode } from '../src/google/oauth.ts';
import { fixture } from './helpers.ts';

// Review fixes, Google Calendar stage 1 (2026-11-21). Addresses are made up.
const config = { poll_s: 60, window_days: 14, reconnect_max_s: 120, hidden_by_default: [], stream_calendar: 'Stream' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('a refresh while a poll runs does not start a second loop: one more poll right after, then one chain', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gcal-'));
  let lists = 0;
  let release: () => void = () => {};
  const fetch = async (url: string | URL | Request) => {
    if (String(url).includes('calendarList')) { lists += 1; if (lists === 1) await new Promise<void>((resolve) => { release = resolve; }); return reply(200, { items: [] }); }
    return reply(200, { items: [] });
  };
  const poller = new CalendarPoller({ accounts: { list: () => [{ email: 'a@example.com' }], accessToken: async () => 't' }, fetch, config: { ...config, poll_s: 0.05 }, dir, onHealth: () => {} });
  try {
    poller.start();
    await wait(20);
    poller.refresh(); // mid-poll
    poller.refresh();
    release();
    await wait(30);
    assert.equal(lists, 2, 'the refresh made exactly one extra poll');
    await wait(160);
    assert.ok(lists >= 3 && lists <= 6, `one chain at 50 ms, not several (${lists})`);
  } finally { poller.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('a removed account leaves nothing behind, even after an error; one failing calendar does not fail the others', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gcal-'));
  let linked = [{ email: 'a@example.com' }];
  let failList = false;
  const fetch = async (url: string | URL | Request) => {
    const text = String(url);
    if (text.includes('calendarList')) return failList ? reply(500, {}) : reply(200, { items: [{ id: 'good' }, { id: 'gone' }, { id: 'odd' }] });
    if (text.includes('/gone/')) return reply(404, {});
    if (text.includes('/odd/')) return reply(200, { items: [{ id: 'x', start: {} }, { id: 'y', start: { dateTime: 'not a date' } }] });
    return reply(200, { items: [{ id: 'e', summary: 's', start: { dateTime: '2026-11-21T10:00:00Z' }, end: { dateTime: '2026-11-21T11:00:00Z' } }] });
  };
  const poller = new CalendarPoller({ accounts: { list: () => linked, accessToken: async () => 't' }, fetch, config, dir, now: () => new Date('2026-11-21T08:00:00Z'), onHealth: () => {} });
  try {
    await poller.poll();
    assert.deepEqual(poller.events('2026-11-21T00:00:00Z', '2026-11-22T00:00:00Z').map((event) => event.calendar), ['good'], 'the 404 and the odd events do not fail the account');
    assert.deepEqual(poller.accountStates(), [{ email: 'a@example.com', state: 'ok' }]);
    failList = true;
    await poller.poll();
    linked = [];
    await poller.poll();
    assert.deepEqual([poller.calendars(), poller.events('2026-11-21T00:00:00Z', '2026-11-22T00:00:00Z')], [[], []]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('without the calendar permission the sign-in fails with a clear reason', async () => {
  const fetch = async () => reply(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'openid email', id_token: idToken('a@example.com') });
  await assert.rejects(exchangeCode({ code: 'c', clientId: 'i', clientSecret: 's', redirectUri: 'https://x/cb', fetch }), /доступ к календарю/);
});

test('a sign-in link works once; an old or used one sends the owner back with a notice, not an error page', async () => {
  const google = async (url: string | URL | Request) => (String(url).includes('oauth2.googleapis.com/token')
    ? reply(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/calendar', id_token: idToken('anna@example.com') })
    : reply(200, { items: [] }));
  const f = await fixture({ google: { fetch: google } });
  try {
    const { url } = await (await f.request('/api/google/connect')).json() as { url: string };
    const state = new URL(url).searchParams.get('state')!;
    const first = await fetch(`${f.base}/api/google/callback?code=c&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    assert.match(first.headers.get('location')!, /google=ok$/);
    const again = await fetch(`${f.base}/api/google/callback?code=c&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    assert.equal(again.status, 302);
    assert.match(again.headers.get('location')!, /google=expired$/);
    const scopeFail = async () => reply(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'openid email', id_token: idToken('boris@example.com') });
    const g = await fixture({ google: { fetch: scopeFail } });
    try {
      const { url: url2 } = await (await g.request('/api/google/connect')).json() as { url: string };
      const denied = await fetch(`${g.base}/api/google/callback?code=c&state=${encodeURIComponent(new URL(url2).searchParams.get('state')!)}`, { redirect: 'manual' });
      assert.match(denied.headers.get('location')!, /google=scope$/);
      assert.deepEqual(((await (await g.request('/api/calendar')).json()) as { accounts: unknown[] }).accounts, []);
    } finally { await g.stop(); }
  } finally { await f.stop(); }
});
