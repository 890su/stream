import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JournalStore } from '../store/store.ts';
import type { LiveFeed } from './live.ts';
import { googleConfig } from '../config.ts';
import { GoogleAccounts, authUrl, checkState, exchangeCode, signState, type Fetch } from '../google/oauth.ts';
import { CalendarPoller } from '../google/calendar.ts';
import { HttpError } from './errors.ts';
import { json, readBody } from './body.ts';
import { stateChanged } from './system.ts';

// The Google Calendar connector's routes (docs/plans/2026-11-20-google-calendar-design.md, stage 1):
// /api/google/connect — the sign-in URL (owner token); /api/google/callback — Google's redirect back (no owner token:
// a signed state instead); /api/calendar — the linked accounts, their calendars and the events for «План»;
// /api/google/calendars — show or hide a calendar; /api/google/accounts/<email> DELETE — forget an account.
// Without the owner's Google client (env) the connector is off and the routes say so.

export const GOOGLE_SOURCE = 'google_calendar';
export type GoogleOptions = { clientId?: string; clientSecret?: string; publicUrl?: string; dir: string; fetch?: Fetch };

export function createGoogle({ store, live, ownerToken, options }: { store: JournalStore; live: LiveFeed; ownerToken: string; options: GoogleOptions }) {
  const { clientId = '', clientSecret = '', publicUrl = 'https://stream.sekond.pl', dir } = options;
  const fetch = options.fetch ?? globalThis.fetch;
  const configured = Boolean(clientId && clientSecret);
  const redirectUri = `${publicUrl.replace(/\/$/, '')}/api/google/callback`;
  const key = createHash('sha256').update(`google-state|${ownerToken}`).digest('base64url'); // never leaves the server
  const accounts = new GoogleAccounts(dir, { clientId, clientSecret, fetch });
  const health = (state: 'ok' | 'login_required' | 'error', detail: string | null) => {
    const previous = store.status.pulse(GOOGLE_SOURCE, state, detail, {}, new Date().toISOString());
    stateChanged(store, live, GOOGLE_SOURCE, state, previous, detail);
  };
  const poller = new CalendarPoller({ accounts, fetch, config: googleConfig, dir, onHealth: health });

  // Google's redirect back after the sign-in.
  async function callback(response: ServerResponse, url: URL): Promise<void> {
    if (!configured) throw new HttpError(409, 'Google не настроен');
    if (!checkState(key, url.searchParams.get('state') ?? '')) throw new HttpError(400, 'Ссылка входа устарела — нажмите «Подключить Google» снова');
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
        result = 'error';
      }
    }
    response.writeHead(302, { Location: `/?google=${result}` });
    response.end();
  }

  // The routes behind the owner token. True when the path was ours.
  async function route(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname === '/api/google/connect' && request.method === 'GET') {
      if (!configured) throw new HttpError(409, 'Google не настроен: нет STREAM_GOOGLE_CLIENT_ID и STREAM_GOOGLE_CLIENT_SECRET в /srv/stream/.env (deploy/GOOGLE.md)');
      json(response, 200, { url: authUrl({ clientId, redirectUri, state: signState(key) }) });
      return true;
    }
    if (url.pathname === '/api/calendar' && request.method === 'GET') {
      const now = Date.now();
      const from = url.searchParams.get('from') ?? new Date(now - 86_400_000).toISOString();
      const to = url.searchParams.get('to') ?? new Date(now + googleConfig.window_days * 86_400_000).toISOString();
      if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new HttpError(400, 'Некорректный интервал');
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

  return { configured, callback, route, start: () => { if (configured) poller.start(); }, stop: () => poller.stop() };
}
