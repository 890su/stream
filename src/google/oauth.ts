import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

// Google sign-in for the calendar connector (docs/plans/2026-11-20-google-calendar-design.md): the owner's own Google
// Cloud client, the sign-in URL with a signed `state` (the callback is the one /api path without the owner token),
// the code exchanged for tokens, refresh tokens kept per account in the data volume (mode 600, never in the journal
// or the log), access tokens refreshed and cached. `fetch` is injected so tests never reach Google.

export type Fetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
export const SCOPES = 'openid email https://www.googleapis.com/auth/calendar';
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const STATE_MS = 10 * 60_000;

// The account must sign in again (the refresh token was revoked or expired).
export class NeedsLogin extends Error {
  readonly email: string;
  constructor(email: string) { super(`Google: нужен вход (${email})`); this.name = 'NeedsLogin'; this.email = email; }
}

const mac = (key: string, text: string) => createHmac('sha256', key).update(text).digest('base64url');

// `<expiry ms>.<nonce>.<mac>`: valid for 10 minutes, made with a key the browser never sees; the server also keeps the
// nonce and lets it through once (src/server/google.ts), so a seen link cannot link another account.
export function signState(key: string, now = Date.now(), nonce = randomBytes(12).toString('base64url')): string {
  const body = `${now + STATE_MS}.${nonce}`;
  return `${body}.${mac(key, body)}`;
}

export const stateNonce = (state: string): string | null => String(state).split('.')[1] ?? null;

export function checkState(key: string, state: string, now = Date.now()): boolean {
  const [expiry, nonce, given] = String(state).split('.');
  if (!expiry || !nonce || !given || !/^\d+$/.test(expiry) || Number(expiry) < now) return false;
  const want = Buffer.from(mac(key, `${expiry}.${nonce}`));
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function authUrl({ clientId, redirectUri, state }: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(AUTH);
  for (const [key, value] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state })) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function token(fetch: Fetch, form: Record<string, string>): Promise<Record<string, any>> {
  const response = await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw Object.assign(new Error(`Google token: ${body.error ?? response.status}`), { code: body.error ?? String(response.status) });
  return body;
}

// The account's email from the id_token (signed by Google and just received over TLS from its token endpoint).
const emailOf = (idToken: string): string => {
  const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1] ?? '', 'base64url').toString('utf8') || '{}') as { email?: string };
  if (!payload.email) throw new Error('Google не сообщил адрес аккаунта');
  return payload.email.toLowerCase();
};

export async function exchangeCode({ code, clientId, clientSecret, redirectUri, fetch }: { code: string; clientId: string; clientSecret: string; redirectUri: string; fetch: Fetch }) {
  const body = await token(fetch, { grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri });
  if (!body.refresh_token) throw new Error('Google не выдал ключ для работы без входа — отключите Stream в аккаунте Google и подключите снова');
  // Google lets the owner untick the calendar on the consent screen: then nothing would work, so say so now.
  if (!String(body.scope ?? '').split(' ').includes('https://www.googleapis.com/auth/calendar')) {
    throw Object.assign(new Error('Google: не разрешён доступ к календарю — подключите снова и разрешите доступ к календарю'), { code: 'scope' });
  }
  return { access_token: String(body.access_token), refresh_token: String(body.refresh_token), expires_in: Number(body.expires_in ?? 3600), email: emailOf(body.id_token) };
}

const safe = (email: string) => { if (!/^[^/\\\s]+@[^/\\\s]+$/.test(email)) throw new Error('Некорректный адрес аккаунта'); return email; };

// The linked accounts: `<dir>/<email>.json` = { email, refresh_token }.
export class GoogleAccounts {
  #dir: string;
  #clientId: string;
  #clientSecret: string;
  #fetch: Fetch;
  #cache = new Map<string, { token: string; until: number }>();

  constructor(dir: string, { clientId, clientSecret, fetch }: { clientId: string; clientSecret: string; fetch: Fetch }) {
    this.#dir = dir;
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
    this.#fetch = fetch;
    mkdirSync(dir, { recursive: true });
  }

  list(): { email: string }[] {
    return readdirSync(this.#dir).filter((name) => name.endsWith('.json') && name.includes('@'))
      .map((name) => ({ email: name.slice(0, -5) })).sort((a, b) => a.email.localeCompare(b.email));
  }

  save(email: string, refreshToken: string): void {
    const file = join(this.#dir, `${safe(email)}.json`);
    writeFileSync(file, JSON.stringify({ email, refresh_token: refreshToken }), { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* not on every file system */ }
    this.#cache.delete(email);
  }

  remove(email: string): void {
    rmSync(join(this.#dir, `${safe(email)}.json`), { force: true });
    this.#cache.delete(email);
  }

  // A valid access token, refreshed a minute before it expires. A revoked refresh token → NeedsLogin.
  async accessToken(email: string, now = Date.now()): Promise<string> {
    const cached = this.#cache.get(email);
    if (cached && cached.until > now) return cached.token;
    let refresh: string;
    try { refresh = (JSON.parse(readFileSync(join(this.#dir, `${safe(email)}.json`), 'utf8')) as { refresh_token: string }).refresh_token; }
    catch { throw new NeedsLogin(email); }
    try {
      const body = await token(this.#fetch, { grant_type: 'refresh_token', refresh_token: refresh, client_id: this.#clientId, client_secret: this.#clientSecret });
      this.#cache.set(email, { token: String(body.access_token), until: now + (Number(body.expires_in ?? 3600) - 60) * 1000 });
      return String(body.access_token);
    } catch (error) {
      if ((error as { code?: string }).code === 'invalid_grant') throw new NeedsLogin(email);
      throw error;
    }
  }
}
