import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './helpers.ts';

// The Google routes (docs/plans/2026-11-20-google-calendar-design.md, stage 1). Addresses are made up.
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`;

function fakeGoogle() {
  return async (url: string | URL | Request) => {
    const text = String(url);
    if (text.startsWith('https://oauth2.googleapis.com/token')) return reply(200, { access_token: 'a1', refresh_token: 'r1', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/calendar', id_token: idToken('anna@example.com') });
    if (text.includes('/users/me/calendarList')) return reply(200, { items: [{ id: 'anna@example.com', summary: 'Анна' }, { id: 'family@group', summary: 'Семья' }] });
    const calendar = decodeURIComponent(text.split('/calendars/')[1]!.split('/events')[0]!);
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    return reply(200, { items: [{ id: `${calendar}-1`, summary: 'встреча', start: { dateTime: soon }, end: { dateTime: soon } }] });
  };
}

test('connect gives a Google URL with a signed state; a bad state is refused; a good one links the account', async () => {
  const f = await fixture({ google: { fetch: fakeGoogle() } });
  try {
    const connect = await f.request('/api/google/connect');
    assert.equal(connect.status, 200);
    const url = new URL(((await connect.json()) as { url: string }).url);
    assert.equal(url.hostname, 'accounts.google.com');
    const state = url.searchParams.get('state')!;
    // The callback comes from Google's redirect: no owner token.
    const bad = await fetch(`${f.base}/api/google/callback?code=c&state=forged.123`, { redirect: 'manual' });
    assert.equal(bad.status, 302);
    assert.match(bad.headers.get('location')!, /google=expired$/);
    assert.deepEqual(((await (await f.request('/api/calendar')).json()) as { accounts: unknown[] }).accounts, [], 'nothing linked by a forged state');
    const good = await fetch(`${f.base}/api/google/callback?code=c&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    assert.equal(good.status, 302);
    assert.match(good.headers.get('location')!, /\?google=ok$/);
    const deadline = Date.now() + 3000;
    let body: { accounts: { email: string }[]; calendars: { id: string }[]; events: { calendar: string }[] };
    do { body = await (await f.request('/api/calendar')).json() as typeof body; } while (!body.events.length && Date.now() < deadline);
    assert.deepEqual(body.accounts.map((item) => item.email), ['anna@example.com']);
    assert.deepEqual(body.events.map((item) => item.calendar).sort(), ['anna@example.com', 'family@group']);
    // Hiding a calendar drops its events.
    assert.equal((await f.request('/api/google/calendars', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'family@group', hidden: true }) })).status, 200);
    body = await (await f.request('/api/calendar')).json() as typeof body;
    assert.deepEqual(body.events.map((item) => item.calendar), ['anna@example.com']);
    // Forgetting the account.
    assert.equal((await f.request('/api/google/accounts/anna%40example.com', { method: 'DELETE' })).status, 200);
    assert.deepEqual(((await (await f.request('/api/calendar')).json()) as { accounts: unknown[] }).accounts, []);
  } finally { await f.stop(); }
});

test('the calendar needs the owner token; without a Google client the routes say so', async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(`${f.base}/api/calendar`)).status, 401);
    const body = await (await f.request('/api/calendar')).json() as { configured: boolean; events: unknown[] };
    assert.deepEqual([body.configured, body.events], [false, []]);
    const connect = await f.request('/api/google/connect');
    assert.equal(connect.status, 409);
    assert.match(((await connect.json()) as { error: string }).error, /STREAM_GOOGLE_CLIENT_ID/);
  } finally { await f.stop(); }
});
