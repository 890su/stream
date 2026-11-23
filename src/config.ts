// Registry files loaded once at start: capture limits, tag dictionary, Telegram and WhatsApp accounts, task triage settings.
import { readFileSync } from 'node:fs';

export const captureConfig = JSON.parse(readFileSync(new URL('../registry/capture.json', import.meta.url), 'utf8')) as {
  max_event_bytes: number; max_media_bytes: number; max_share_bytes: number;
  default_page_size: number; max_page_size: number; mime_types: string[];
  min_owner_token_length: number;
  burst_gap_min: number; collapse_chars: number; collapse_lines: number;
};

// Tag dictionary (CONCEPT.md §2.2): suggestion hints, auto-activation threshold, engine version.
export const tagConfig = JSON.parse(readFileSync(new URL('../registry/tags.json', import.meta.url), 'utf8')) as {
  version: number; engine: string; auto_threshold: number; suggest_limit: number;
  tags: Array<{ tag: string; intent?: string; hints: string[] }>;
};

// Telegram account bots (CONCEPT.md §8.2): accounts, file limit, reply window, silence threshold.
export const telegramConfig = JSON.parse(readFileSync(new URL('../registry/telegram.json', import.meta.url), 'utf8')) as {
  version: number;
  accounts: Record<string, { title: string; connector: string; sphere: string; timezone: string }>;
  media_max_bytes: number; silent_after_s: number; reply_window_h: number;
  address_book: { frequent_days: number; row_size: number };
};

// WhatsApp linked devices (docs/plans/2026-11-20-whatsapp-baileys-design.md): accounts, file limit, oldest live
// message written, how far back the history sent at linking is taken, reconnect ceiling, QR refresh, pulse while
// connected (below the System screen's silence threshold).
// An account's connector is always `whatsapp_<account>` (the web client derives it).
export const whatsappConfig = JSON.parse(readFileSync(new URL('../registry/whatsapp.json', import.meta.url), 'utf8')) as {
  version: number;
  accounts: Record<string, { title: string; connector: string; sphere: string; timezone: string }>;
  media_max_bytes: number; max_age_h: number; history_h: number; reconnect_max_s: number; qr_refresh_s: number; pulse_s: number;
};
for (const [key, account] of Object.entries(whatsappConfig.accounts)) {
  if (account.connector !== `whatsapp_${key}`) throw new Error(`registry/whatsapp.json: коннектор аккаунта ${key} должен быть whatsapp_${key}`);
}

// Google Calendar (docs/plans/2026-11-20-google-calendar-design.md): how often calendars are read, how far ahead,
// the backoff ceiling, calendars hidden until the owner shows them (id patterns), the name of the synced calendar.
export const googleConfig = JSON.parse(readFileSync(new URL('../registry/google.json', import.meta.url), 'utf8')) as {
  version: number; poll_s: number; window_days: number; reconnect_max_s: number; hidden_by_default: string[]; stream_calendar: string;
};

// Task triage (CONCEPT.md §2.8): quiet window, AI model and budget, task templates.
export const tasksConfig = JSON.parse(readFileSync(new URL('../registry/tasks.json', import.meta.url), 'utf8')) as {
  version: number; quiet_s: number; quiet_s_by_stream: Record<string, number>; lookback_h: number; max_batch: number; session_gap_h: number; session_messages: number; earlier_max: number; history_days: number; open_tasks_in_context: number; closed_tasks_in_context: number; reopen_days: number; job_days: number; low_confidence: number; ai_log: { keep_days: number };
  ai: { provider: string; model: string; effort: string; max_tokens: number; monthly_budget_usd: number; price_per_mtok: { input: number; output: number }; processor: string; message_rules: string[] };
  assignees: string[];
  card: { default_duration_min: number; durations_min: number[]; repeats: { every: 'day' | 'week' | 'month' | 'year' | null; label: string }[]; participant_suggestions: number };
  templates: Array<{ name: string; tag: string | null; title: string; assignee: string; filed: boolean; instruction: string; report?: string[]; legacy?: boolean }>;
  report_default: string[]; report_fields: Record<string, { title: string; type: 'datetime' | 'minutes' | 'money' | 'tags' | 'text' }>; currencies: string[];
  unsorted: { title: string; note: string };
};

export type TopicDays = { topic_days: number; archive_days: number };
// Conversations (CONCEPT.md §2.5): the queue — how old a waiting message may be, the «⏱ Отложить» presets.
type SnoozeAt = { hour: number; until_hour?: number; from_hour?: number };
export const conversationsConfig = JSON.parse(readFileSync(new URL('../registry/conversations.json', import.meta.url), 'utf8')) as {
  version: number;
  topics: TopicDays; // topics design 2026-11-23: how long a topic stays live; the owner's values — src/ownersettings.ts
  queue: { since: string; snooze: { minutes: number[]; noon: SnoozeAt; evening: SnoozeAt; tomorrow_day: SnoozeAt; morning: SnoozeAt };
    swipe?: { minutes: number[]; parts: { key: string; label: string; icon: string; hour: number }[]; days: number; day_hour: number } };
};

// Saved task filters (P14): conditions over folded tasks; the first one is the default (web/filters.js).
type FilterCondition = { field: string; op: string; value?: unknown } | { all: FilterCondition[] } | { any: FilterCondition[] };
export const filtersConfig = JSON.parse(readFileSync(new URL('../registry/filters.json', import.meta.url), 'utf8')) as {
  version: number; filters: Array<{ id: string; title: string; all?: FilterCondition[]; any?: FilterCondition[]; order?: 'updated' | 'due'; view?: 'pulse';
    sections?: Array<{ id: string; title: string; folded?: boolean; all?: FilterCondition[]; any?: FilterCondition[] }> }>;
};

// The pulse — the default of «Задачи» (task manager spec §5): block sizes, thresholds and importance weights.
export const pulseConfig = JSON.parse(readFileSync(new URL('../registry/pulse.json', import.meta.url), 'utf8')) as {
  version: number; rows: number; hot_wait_hours: number; watch_alert_days: number; stale_days: number; paused_remind_hours: number;
  money_templates: string[]; weights: { hot: number; money: number; blocks: number; due_soon: number; stale_per_day: number };
};
