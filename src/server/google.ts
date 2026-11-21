import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JournalStore } from '../store/store.ts';
import type { LiveFeed } from './live.ts';
import { googleConfig } from '../config.ts';
import { GoogleAccounts, authUrl, checkState, exchangeCode, signState, stateNonce, type Fetch } from '../google/oauth.ts';
import { CalendarPoller } from '../google/calendar.ts';
import { HttpError } from './errors.ts';
import { json, readBody } from './body.ts';
import { stateChanged } from './system.ts';

// The Google Calendar connector's routes (docs/plans/2026-11-20-google-calendar-design.md, stage 1):
// /api/google/connect — the sign-in URL (owner token); /api/google/callback — Google's redirect back (no owner token:
// a signed state instead); /api/calendar — the linked accounts, their calendars and the events for «План»;
// /api/google/calendars — show or hide a calendar; /api/google/accounts/<email> DELETE — forget an account.
// Without the owner's Google client (entered on the System screen, or in .env) the connector is off and says so; the
// client entered while the server runs turns it on at once (`reconfigure`).

export const GOOGLE_SOURCE = 'google_calendar';
export type GoogleOptions = { clientId?: string; clientSecret?: string; credentials?: () => { clientId?: string; clientSecret?: string }; enabled?: () => boolean; publicUrl?: string; dir: string; fetch?: Fetch };

export function createGoogle({ store, live, ownerToken, options }: { store: JournalStore; live: LiveFeed; ownerToken: string; options: GoogleOptions }) {
  const { publicUrl = 'https://stream.sekond.pl', dir } = options;
  const fetch = options.fetch ?? globalThis.fetch;
  const credentials = () => {
    const given = options.credentials?.() ?? { clientId: options.clientId, clientSecret: options.clientSecret };
    return { clientId: given.clientId ?? '', clientSecret: given.clientSecret ?? '' };
  };
  const isConfigured = () => { const { clientId, clientSecret } = credentials(); return Boolean(clientId && clientSecret); };
  const redirectUri = `${publicUrl.replace(/\/$/, '')}/api/google/callback`;
  const key = createHash('sha256').update(`google-state|${ownerToken}`).digest('base64url'); // never leaves the server
  const accounts = new GoogleAccounts(dir, { credentials, fetch });
  const health = (state: 'ok' | 'login_required' | 'error', detail: string | null) => {
    const previous = store.status.pulse(GOOGLE_SOURCE, state, detail, {}, new Date().toISOString());
    stateChanged(store, live, GOOGLE_SOURCE, state, previous, detail);
  };
  const issued = new Map<string, number>(); // nonces of sign-in links given out, each let through once
  const poller = new CalendarPoller({ accounts, fetch, config: googleConfig, dir, onHealth: health });

  // Google's redirect back after the sign-in.
  // The owner arrives here in the browser: always a redirect back to Stream with the outcome, never an error page.
  async function callback(response: ServerResponse, url: URL): Promise<void> {
    const back = (result: string) => { response.writeHead(302, { Location: `/?google=${result}` }); response.end(); };
    if (!isConfigured()) { back('error'); return; }
    const { clientId, clientSecret } = credentials();
    const state = url.searchParams.get('state') ?? '';
    const nonce = stateNonce(state);
    const fresh = checkState(key, state) && nonce !== null && issued.has(nonce);
    if (nonce) issued.delete(nonce);
    if (!fresh) { back('expired'); return; }
    const code = url.searchParams.get('code');
    let result = 'ok';
    if (!code) result = 'error';
    else {
      try {
        const tokens = await exchangeCode({ code, clientId, clientSecret, redirectUri, fetch });
        accounts.save(tokens.email, tokens.refresh_token);
        console.log('Google: account linked');
        poller.refresh();
      } catch (error) {
        console.error('Google: linking failed —', error instanceof Error ? error.message.slice(0, 120) : 'error');
        result = (error as { code?: string }).code === 'scope' ? 'scope' : 'error';
      }
    }
    back(result);
  }

  // The routes behind the owner token. True when the path was ours.
  async function route(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname === '/api/google/connect' && request.method === 'GET') {
      if (!isConfigured()) throw new HttpError(409, 'Google не настроен: введите Client ID и Client secret на экране «Система» (deploy/GOOGLE.md)');
      const { clientId } = credentials();
      const now = Date.now();
      for (const [nonce, until] of issued) if (until < now) issued.delete(nonce);
      const state = signState(key, now);
      issued.set(stateNonce(state)!, now + 10 * 60_000);
      json(response, 200, { url: authUrl({ clientId, redirectUri, state }) });
      return true;
    }
    if (url.pathname === '/api/calendar' && request.method === 'GET') {
      const now = Date.now();
      const from = url.searchParams.get('from') ?? new Date(now - 86_400_000).toISOString();
      const to = url.searchParams.get('to') ?? new Date(now + googleConfig.window_days * 86_400_000).toISOString();
      if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new HttpError(400, 'Некорректный интервал');
      const configured = isConfigured();
      json(response, 200, { configured, accounts: configured ? poller.accountStates() : [], calendars: configured ? poller.calendars() : [], events: configured ? poller.events(from, to) : [] });
      return true;
    }
    if (url.pathname === '/api/google/calendars' && request.method === 'POST') {
      const body = JSON.parse((await readBody(request, 4096)).toString('utf8') || '{}') as { id?: unknown; hidden?: unknown };
      if (typeof body.id !== 'string' || typeof body.hidden !== 'boolean') throw new HttpError(400, 'Нужны id календаря и hidden');
      poller.setHidden(body.id, body.hidden);
      if (!body.hidden) poller.refresh(); // its events are read only while shown
      json(response, 200, { ok: true });
      return true;
    }
    const account = /^\/api\/google\/accounts\/([^/]+)$/.exec(url.pathname);
    if (account && request.method === 'DELETE') {
      accounts.remove(decodeURIComponent(account[1]!));
      poller.refresh();
      json(response, 200, { ok: true });
      return true;
    }
    return false;
  }

  let started = false; // the server is listening
  let polling = false;
  const reconfigure = () => {
    if (!started) return;
    const on = isConfigured() && (options.enabled?.() ?? true); // switched off on the System screen: no reading
    if (on && !polling) { poller.start(); polling = true; }
    else if (!on && polling) { poller.stop(); polling = false; }
  };
  return { callback, route, reconfigure, start: () => { started = true; reconfigure(); }, stop: () => { started = false; polling = false; poller.stop(); } };
}
