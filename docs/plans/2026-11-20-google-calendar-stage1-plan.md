# Google Календарь, этап 1: вход и занятость в «Плане» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner links his Google accounts from «Система»; every calendar of them (except holidays and those switched off) shows in the right panel «План» as grey rows among the tasks of each day.

**Architecture:** An in-process connector (`src/google/`) like WhatsApp: OAuth 2.0 with the owner's Google Cloud client (id/secret in `/srv/stream/.env`), refresh tokens in the data volume, a poll every `poll_s` reading events of the visible calendars in a window of `window_days`, kept in memory and served at `/api/calendar`. No new dependencies — `fetch` to Google's endpoints, injectable for tests. Stage 2 (the «Stream» calendar, two-way) is a separate plan.

**Tech Stack:** Node 24 TypeScript (no build), buildless ESM PWA, `node --test`.

**Spec:** `docs/plans/2026-11-20-google-calendar-design.md` (stage 1).

## Global Constraints

- Secrets only in `/srv/stream/.env`: `STREAM_GOOGLE_CLIENT_ID`, `STREAM_GOOGLE_CLIENT_SECRET`; tokens in `<DATA_DIR>/google/` (file mode 600), never in git, the journal or logs. Logs carry account ids and states only — no event titles.
- OAuth scopes exactly: `openid email https://www.googleapis.com/auth/calendar` (calendar write is needed in stage 2; asked once).
- Redirect URI: `https://stream.sekond.pl/api/google/callback` (from `STREAM_PUBLIC_URL`, default that); `/api/google/callback` is the only `/api/*` path without the owner token, protected by an HMAC-signed `state` (key derived from the owner token, 10-minute expiry).
- Data, not code: `registry/google.json` — `{ version: 1, poll_s: 60, window_days: 14, hidden_by_default: ["#holiday@group.v.calendar.google.com"], stream_calendar: "Stream" }`.
- Owner-facing text in Russian; one file one job (≤ ~300 lines) with an English header; new `web/*.js` → `VERSIONED` + `web/sw.js`.
- The connector never stops the server: every poll isolated, backoff like WhatsApp (`reconnect_max_s` 120).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; deploy `install.sh main`.

## Review Focus

1. A revoked or expired refresh token (`invalid_grant`) → the account shows «нужен вход» with «Подключить» again, other accounts keep working — Task 2 test.
2. A forged or stale `state` on the callback is refused (400) and writes nothing — Task 3 test.
3. All-day events and events in other time zones land on the right local day in «План» — Task 4 and Task 6 tests.
4. Google down or rate-limited: the last good events stay shown, the state says «ошибка», no crash — Task 4 test.
5. The client never sees tokens; `/api/calendar` requires the owner token — Task 3 test.

---

### Task 1: registry, config, connector entry

**Files:** Create `registry/google.json`; Modify `src/config.ts` (`googleConfig`), `registry/connectors.yaml` (`google_calendar`, status planned→active wording), `src/server/system.ts` (`sourceTitle` → «Google Календарь»).
**Test:** `test/google-config.test.ts` — the registry loads with the fields above; `sourceTitle('google_calendar')` is «Google Календарь».

- [ ] Failing test → run (`node --test test/google-config.test.ts`, FAIL) → implement → PASS → commit `Google: registry and connector entry`.

### Task 2: OAuth — `src/google/oauth.ts`

**Interfaces (produces):**
- `signState(key: string, now: number) → string`, `checkState(key, state, now) → boolean` (HMAC-SHA256, `<expiry>.<mac>`, 10 min).
- `authUrl({ clientId, redirectUri, state }) → string` (`access_type=offline`, `prompt=consent`, the scopes above).
- `exchangeCode({ code, clientId, clientSecret, redirectUri, fetch }) → { refresh_token, access_token, expires_in, email }` (email from the `id_token` payload).
- `class GoogleAccounts(dir, { clientId, clientSecret, fetch })`: `list() → { email }[]`, `save(email, refreshToken)`, `remove(email)`, `accessToken(email) → string` (cached until 60 s before expiry; `invalid_grant` → throws `NeedsLogin`).

- [ ] Failing tests in `test/google-oauth.test.ts`: state round-trip, tampered and expired states rejected; `authUrl` has the scopes, offline access, the redirect; `exchangeCode` with a fake fetch returns the email from a made-up `id_token`; `accessToken` refreshes once and caches; `invalid_grant` → `NeedsLogin`; a saved file is mode 600 (skip the mode check on Windows).
- [ ] Run → FAIL → implement → PASS → commit `Google: OAuth sign-in and tokens`.

### Task 3: routes — connect, callback, calendar, visibility

**Files:** Create `src/server/google.ts`; Modify `src/server/http.ts` (callback before the auth check; the other routes after it), `src/main.ts` (enable when both env vars are set).
**Interfaces:** `GET /api/google/connect` → `{ url }`; `GET /api/google/callback?code&state` → saves the account, redirects `302 /?google=ok` (or `?google=error`); `GET /api/calendar?from&to` → `{ accounts: [{ email, state }], calendars: [{ id, account, title, color, hidden }], events: [{ id, calendar, title, start, end, allDay, link }] }`; `POST /api/google/calendars` `{ id, hidden }` → saved in `<DATA_DIR>/google/settings.json`; `DELETE /api/google/accounts/<email>` → forget the account.

- [ ] Failing tests in `test/google-routes.test.ts` (fixture with a fake fetch): connect needs the owner token and returns a Google URL with a valid state; callback with a bad state → 400 and nothing saved; a good one → 302 and the account listed; `/api/calendar` without token → 401; hiding a calendar drops its events from the answer.
- [ ] Run → FAIL → implement → PASS → commit `Google: connect, callback and calendar routes`.

### Task 4: the poller — `src/google/calendar.ts`

**Interfaces:** `normalizeEvent(raw, calendar) → { id, calendar, title, start, end, allDay, link } | null` (cancelled → null; all-day keeps `YYYY-MM-DD`; timed → ISO with offset); `class CalendarPoller({ accounts, store, live, fetch, config })`: `start()`, `stop()`, `events(from, to)`, `calendars()`; health on `google_calendar` via `store.status.pulse` (ok / login_required «войдите в Google» / error), state changes as system events like WhatsApp.
Poll: per account `calendarList` then `events?singleEvents=true&orderBy=startTime&timeMin&timeMax` per visible calendar; errors keep the last good set.

- [ ] Failing tests in `test/google-calendar.test.ts`: normalize an all-day, a timed event in another zone, a cancelled one; a poll with a fake fetch fills `events()`; a 500 keeps the previous events and sets «ошибка»; `NeedsLogin` for one account → login_required while the other's events stay.
- [ ] Run → FAIL → implement → PASS → commit `Google: calendar poller`.

### Task 5: «Система» — connect, accounts, calendars

**Files:** Modify `web/system.js` (+ a small `web/googlebox.js` if `system.js` would pass ~300 lines), `web/screens.css`.
On the `google_calendar` row: «Подключить Google» (fetches `/api/google/connect`, goes to the URL); each account with «Отключить»; each calendar with a switch «показывать в Плане». After `?google=ok|error` a toast «Google подключён» / «Не удалось подключить Google».
**Test:** pure `calendarToggles(calendars) → [{ id, title, account, on }]` in `test/google-ui.test.ts`.

- [ ] Failing test → run → implement → PASS → browser check (preview, fake connector state) → commit `Google: connect and calendars on «Система»`.

### Task 6: «План» shows the events

**Files:** Modify `web/dayplan.js` (`plannerDays(tasks, { now, days, events })` puts events on their days with `kind: 'event'`; rows grey with time and calendar title, a tap opens `link` in a new tab), `web/details.js` (fetches `/api/calendar` for the shown range when the plan draws, at most once a minute, cached).
- [ ] Failing tests in `test/planner.test.ts`: an all-day event on its day without a time; a timed event sorted among tasks by time; an event of another zone on the local day; overdue never holds events.
- [ ] Run → FAIL → implement → PASS → browser check on 375 px with a fake `/api/calendar` → commit `Google: calendar events in «План»`.

### Task 7: owner guide, docs, deploy

**Files:** Create `deploy/GOOGLE.md` (Google Cloud project step by step: Calendar API, consent screen External + «В работе», OAuth client Web with the redirect URI, the two `.env` lines, «Подключить Google»; what «приложение не проверено» means; how to disconnect); Modify `deploy/install.sh` (reports «Google: enabled / off» from the env without printing values), `docs/CODEMAP.md`, `PLAN.md`, `decisions.md`, `CONCEPT.md` §5 (right panel: events).
- [ ] `pnpm test`, `pnpm typecheck` → green → commit `Google: guide and docs` → push → deploy → healthz ok; «Система» shows «Google Календарь — нужен вход» until the owner sets it up.
