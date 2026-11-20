import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signState, checkState, authUrl, exchangeCode, GoogleAccounts, NeedsLogin } from '../src/google/oauth.ts';

// Google sign-in (docs/plans/2026-11-20-google-calendar-design.md): a signed state, the URL, tokens. Addresses are made up.
const KEY = 'k'.repeat(40);
const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('the state is signed and expires; a changed or old one is refused', () => {
  const now = Date.parse('2026-11-21T10:00:00Z');
  const state = signState(KEY, now);
  assert.equal(checkState(KEY, state, now + 60_000), true);
  assert.equal(checkState(KEY, state, now + 11 * 60_000), false, 'older than 10 minutes');
  assert.equal(checkState('other'.repeat(10), state, now), false, 'another key');
  assert.equal(checkState(KEY, state.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), now), false, 'tampered');
  assert.equal(checkState(KEY, 'garbage', now), false);
});

test('the sign-in URL asks for the calendar offline, with consent, and comes back to Stream', () => {
  const url = new URL(authUrl({ clientId: 'client-1', redirectUri: 'https://stream.example/api/google/callback', state: 'st' }));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('scope'), 'openid email https://www.googleapis.com/auth/calendar');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://stream.example/api/google/callback');
  assert.equal(url.searchParams.get('state'), 'st');
});

test('a code becomes tokens and the account email', async () => {
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), 'https://oauth2.googleapis.com/token');
    assert.match(String(init?.body), /grant_type=authorization_code/);
    return reply(200, { access_token: 'a1', refresh_token: 'r1', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/calendar', id_token: idToken('anna@example.com') });
  };
  const tokens = await exchangeCode({ code: 'c', clientId: 'id', clientSecret: 's', redirectUri: 'https://x/cb', fetch });
  assert.deepEqual([tokens.email, tokens.refresh_token], ['anna@example.com', 'r1']);
});

test('accounts: saved privately; an access token is refreshed once and cached; a revoked one needs a new sign-in', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'google-'));
  try {
    let calls = 0;
    let revoked = false;
    const fetch = async () => { calls += 1; return revoked ? reply(400, { error: 'invalid_grant' }) : reply(200, { access_token: `a${calls}`, expires_in: 3600 }); };
    const accounts = new GoogleAccounts(dir, { clientId: 'id', clientSecret: 's', fetch });
    accounts.save('anna@example.com', 'r1');
    if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'anna@example.com.json')).mode & 0o777, 0o600);
    assert.deepEqual(accounts.list().map((item) => item.email), ['anna@example.com']);
    assert.equal(await accounts.accessToken('anna@example.com'), 'a1');
    assert.equal(await accounts.accessToken('anna@example.com'), 'a1', 'cached');
    assert.equal(calls, 1);
    accounts.save('anna@example.com', 'r2'); // a new sign-in drops the cache
    revoked = true;
    await assert.rejects(accounts.accessToken('anna@example.com'), NeedsLogin);
    accounts.remove('anna@example.com');
    assert.deepEqual(accounts.list(), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
