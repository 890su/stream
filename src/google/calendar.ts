import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NeedsLogin, type Fetch } from './oauth.ts';

// Reading the owner's Google calendars (docs/plans/2026-11-20-google-calendar-design.md, stage 1): every `poll_s` the
// calendar list of each linked account and the events of the visible calendars over `window_days`, kept in memory for
// «План» (/api/calendar). A calendar shared between accounts is read once. Which calendars show is the owner's choice
// (`settings.json` in the data folder; holidays hidden by default). An outage keeps the last good events; an account
// that must sign in again does not stop the others. Only states and ids reach the log, never event titles.

const API = 'https://www.googleapis.com/calendar/v3';
type SourceState = 'ok' | 'login_required' | 'error';
export type CalendarEvent = { id: string; calendar: string; title: string; start: string; end: string; allDay: boolean; link: string | null };
export type CalendarInfo = { id: string; title: string; account: string; color: string | null; hidden: boolean };
type Accounts = { list(): { email: string }[]; accessToken(email: string): Promise<string> };
type Config = { poll_s: number; window_days: number; reconnect_max_s: number; hidden_by_default: string[]; stream_calendar: string };

// One event as «План» shows it: all-day keeps its days (`YYYY-MM-DD`, the end exclusive), a timed one its instants.
export function normalizeEvent(raw: Record<string, any>, calendar: string): CalendarEvent | null {
  if (!raw || raw.status === 'cancelled' || !raw.start) return null;
  const allDay = Boolean(raw.start.date);
  const instant = (part: Record<string, string> | undefined) => (allDay ? String(part?.date ?? raw.start.date) : new Date(part?.dateTime ?? raw.start.dateTime).toISOString());
  return { id: String(raw.id), calendar, title: String(raw.summary ?? '').trim() || '(без названия)', start: instant(raw.start), end: instant(raw.end ?? raw.start), allDay, link: raw.htmlLink ?? null };
}

export class CalendarPoller {
  #accounts: Accounts;
  #fetch: Fetch;
  #config: Config;
  #file: string;
  #now: () => Date;
  #onHealth: (state: SourceState, detail: string | null) => void;
  #hidden: Record<string, boolean>;
  #calendars = new Map<string, CalendarInfo>();
  #events = new Map<string, CalendarEvent[]>(); // calendar id -> its events of the window
  #states = new Map<string, SourceState>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #delay: number;
  #running = false;

  constructor({ accounts, fetch, config, dir, now = () => new Date(), onHealth }: { accounts: Accounts; fetch: Fetch; config: Config; dir: string; now?: () => Date; onHealth: (state: SourceState, detail: string | null) => void }) {
    this.#accounts = accounts;
    this.#fetch = fetch;
    this.#config = config;
    this.#file = join(dir, 'settings.json');
    this.#now = now;
    this.#onHealth = onHealth;
    this.#delay = config.poll_s * 1000;
    let saved: { hidden?: Record<string, boolean> } = {};
    try { if (existsSync(this.#file)) saved = JSON.parse(readFileSync(this.#file, 'utf8')); } catch { /* a broken file: defaults */ }
    this.#hidden = saved.hidden ?? {};
  }

  start(): void { this.#running = true; void this.#loop(); }
  stop(): void { this.#running = false; if (this.#timer) clearTimeout(this.#timer); this.#timer = null; }
  // Read again now (a new account, a calendar shown).
  refresh(): void { if (this.#running) { if (this.#timer) clearTimeout(this.#timer); void this.#loop(); } }

  async #loop(): Promise<void> {
    let failed = false;
    try { failed = !(await this.poll()); } catch (error) { failed = true; console.error('Google: poll failed —', error instanceof Error ? error.name : 'error'); }
    if (!this.#running) return;
    this.#delay = failed ? Math.min(this.#delay * 2, this.#config.reconnect_max_s * 1000) : this.#config.poll_s * 1000;
    this.#timer = setTimeout(() => void this.#loop(), this.#delay);
    this.#timer.unref?.();
  }

  isHidden(id: string): boolean {
    return this.#hidden[id] ?? this.#config.hidden_by_default.some((pattern) => id.includes(pattern));
  }

  setHidden(id: string, hidden: boolean): void {
    this.#hidden[id] = hidden;
    writeFileSync(this.#file, JSON.stringify({ hidden: this.#hidden }));
    const info = this.#calendars.get(id);
    if (info) info.hidden = hidden;
  }

  calendars(): CalendarInfo[] { return [...this.#calendars.values()]; }
  accountStates(): { email: string; state: SourceState }[] { return this.#accounts.list().map(({ email }) => ({ email, state: this.#states.get(email) ?? 'ok' })); }

  // Events of the visible calendars that overlap [from, to).
  events(from: string, to: string): CalendarEvent[] {
    const lo = Date.parse(from);
    const hi = Date.parse(to);
    const at = (value: string) => Date.parse(value.length === 10 ? `${value}T00:00:00` : value);
    return [...this.#events.entries()].filter(([id]) => this.#calendars.has(id) && !this.isHidden(id))
      .flatMap(([, list]) => list).filter((event) => at(event.start) < hi && at(event.end) > lo)
      .sort((a, b) => at(a.start) - at(b.start));
  }

  async #get(token: string, path: string): Promise<Record<string, any>> {
    const response = await this.#fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) throw Object.assign(new Error('Google: 401'), { unauthorized: true });
    if (!response.ok) throw new Error(`Google: ${response.status}`);
    return await response.json() as Record<string, any>;
  }

  // One round over all accounts. True when everything was read.
  async poll(): Promise<boolean> {
    const accounts = this.#accounts.list();
    if (!accounts.length) { this.#onHealth('login_required', 'подключите Google на экране «Система»'); return true; }
    const now = this.#now();
    const timeMin = new Date(now.getTime() - 86_400_000).toISOString();
    const timeMax = new Date(now.getTime() + this.#config.window_days * 86_400_000).toISOString();
    const seen = new Set<string>();
    const calendars = new Map<string, CalendarInfo>();
    let ok = true;
    for (const { email } of accounts) {
      try {
        const token = await this.#accounts.accessToken(email);
        const list = await this.#get(token, '/users/me/calendarList?maxResults=250');
        for (const item of list.items ?? []) {
          if (calendars.has(item.id)) continue;
          calendars.set(item.id, { id: item.id, title: item.summaryOverride ?? item.summary ?? item.id, account: email, color: item.backgroundColor ?? null, hidden: this.isHidden(item.id) });
        }
        for (const item of list.items ?? []) {
          if (seen.has(item.id) || this.isHidden(item.id)) continue;
          seen.add(item.id);
          const query = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', timeMin, timeMax, maxResults: '2500' });
          const events = await this.#get(token, `/calendars/${encodeURIComponent(item.id)}/events?${query}`);
          this.#events.set(item.id, (events.items ?? []).map((raw: Record<string, any>) => normalizeEvent(raw, item.id)).filter(Boolean));
        }
        this.#states.set(email, 'ok');
      } catch (error) {
        ok = false;
        const state: SourceState = error instanceof NeedsLogin ? 'login_required' : 'error';
        this.#states.set(email, state);
        if (state === 'login_required') for (const [id, info] of this.#calendars) if (info.account === email) this.#events.delete(id);
        console.error(`Google ${email}: ${state}`);
      }
    }
    for (const [id, info] of this.#calendars) if (!calendars.has(id) && this.#states.get(info.account) !== 'ok') calendars.set(id, info); // keep what a failed account had
    this.#calendars = calendars;
    const states = this.accountStates();
    const login = states.filter((item) => item.state === 'login_required').map((item) => item.email);
    if (login.length) this.#onHealth('login_required', `войдите в Google снова: ${login.join(', ')}`);
    else if (states.some((item) => item.state === 'error')) this.#onHealth('error', 'Google не ответил — показаны последние полученные события');
    else this.#onHealth('ok', null);
    return ok;
  }
}
